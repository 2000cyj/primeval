/**
 * 内置 Wiki 本地工具的单元测试。
 *
 * 用临时目录造几个页面，覆盖 list / read / search 三件事：
 * - 目录结构与桌面端一致（<slug>/page.md + <slug>/.meta.json）
 * - 元信息缺字段 / 文件坏了也不该报错
 * - slug 不能穿越目录
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/client'
import {
  createWikiTools,
  isSafeSlug,
  listWikiPages,
  readWikiPage,
  searchWiki,
} from '../src/wiki.ts'

let root = ''

/** 造一个页面（正文 + 元信息） */
async function writePage(
  slug: string,
  options: {
    title?: string
    tags?: string[]
    parent?: string | null
    links?: string[]
    content?: string
    createdAt?: number
    updatedAt?: number
    withMeta?: boolean
  } = {},
): Promise<void> {
  const dir = join(root, slug)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'page.md'), options.content ?? `# ${slug}\n`, 'utf8')
  if (options.withMeta === false) return
  const meta = {
    slug,
    title: options.title ?? slug,
    tags: options.tags ?? [],
    parent: options.parent ?? null,
    links: options.links ?? [],
    createdAt: options.createdAt ?? 1_700_000_000_000,
    updatedAt: options.updatedAt ?? 1_700_000_000_001,
  }
  await writeFile(join(dir, '.meta.json'), JSON.stringify(meta), 'utf8')
}

/** 把工具结果里的文本块取出来 */
function texts(result: CallToolResult): string[] {
  const out: string[] = []
  for (const item of result.content) {
    if (item.type === 'text') out.push(item.text)
  }
  return out
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentspace-wiki-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Wiki：列出页面', () => {
  it('列出全部页面的元信息', async () => {
    await writePage('deploy', { title: '部署手册', tags: ['运维'] })
    await writePage('sign', { title: '签名流程' })

    const pages = await listWikiPages(root)
    expect(pages.map((page) => page.slug)).toEqual(['deploy', 'sign'])
    expect(pages[0]?.title).toBe('部署手册')
    expect(pages[0]?.tags).toEqual(['运维'])
    expect(pages[0]?.parent).toBeNull()
    expect(pages[0]?.createdAt).toBe(1_700_000_000_000)
  })

  it('按标题排序', async () => {
    await writePage('b', { title: 'B 页面' })
    await writePage('a', { title: 'A 页面' })
    const pages = await listWikiPages(root)
    expect(pages.map((page) => page.title)).toEqual(['A 页面', 'B 页面'])
  })

  it('wiki 目录不存在时返回空列表（不是错误）', async () => {
    const pages = await listWikiPages(join(root, 'not-exist'))
    expect(pages).toEqual([])
  })

  it('没有正文的目录不算页面', async () => {
    await mkdir(join(root, 'empty'), { recursive: true })
    await writePage('real', { title: '真页面' })
    const pages = await listWikiPages(root)
    expect(pages.map((page) => page.slug)).toEqual(['real'])
  })

  it('元信息文件坏了也能列出（用默认值补齐）', async () => {
    const dir = join(root, 'broken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'page.md'), '# broken\n', 'utf8')
    await writeFile(join(dir, '.meta.json'), '{ 这不是 json', 'utf8')

    const pages = await listWikiPages(root)
    expect(pages).toHaveLength(1)
    expect(pages[0]?.slug).toBe('broken')
    // 标题为空时用 slug 顶上
    expect(pages[0]?.title).toBe('broken')
    expect(pages[0]?.tags).toEqual([])
    expect(pages[0]?.parent).toBeNull()
  })

  it('没有元信息文件时标题回落到 slug', async () => {
    await writePage('orphan', { withMeta: false })
    const pages = await listWikiPages(root)
    expect(pages[0]?.title).toBe('orphan')
  })
})

describe('Wiki：读取页面', () => {
  it('返回正文与元信息', async () => {
    await writePage('deploy', {
      title: '部署手册',
      tags: ['运维'],
      content: '# 部署手册\n\n先构建再发布。',
    })
    const page = await readWikiPage(root, 'deploy')
    expect(page?.content).toBe('# 部署手册\n\n先构建再发布。')
    expect(page?.title).toBe('部署手册')
    expect(page?.tags).toEqual(['运维'])
  })

  it('页面不存在返回 null', async () => {
    expect(await readWikiPage(root, 'nope')).toBeNull()
  })

  it('slug 不能穿越目录', async () => {
    expect(await readWikiPage(root, '../secret')).toBeNull()
    expect(await readWikiPage(root, 'a/b')).toBeNull()
    expect(isSafeSlug('../secret')).toBe(false)
    expect(isSafeSlug('a/b')).toBe(false)
    expect(isSafeSlug('')).toBe(false)
    expect(isSafeSlug('deploy')).toBe(true)
  })
})

describe('Wiki：搜索', () => {
  it('标题命中时给出 slug 与标题', async () => {
    await writePage('sign', { title: '签名流程', content: '第一步：生成密钥' })
    const hits = await searchWiki(root, '签名')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.slug).toBe('sign')
    expect(hits[0]?.title).toBe('签名流程')
    expect(hits[0]?.line).toBe(1)
  })

  it('正文命中时给出行号（从 1 开始）', async () => {
    await writePage('sign', {
      title: '签名流程',
      content: '第一步：生成密钥\n第二步：签名\n第三步：上传',
    })
    const hits = await searchWiki(root, '第二步')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.line).toBe(2)
    expect(hits[0]?.snippet).toContain('第二步')
  })

  it('大小写不敏感', async () => {
    await writePage('sign', { title: 'Signing', content: 'hello world' })
    expect(await searchWiki(root, 'signing')).toHaveLength(1)
    expect(await searchWiki(root, 'HELLO')).toHaveLength(1)
  })

  it('空查询不返回东西', async () => {
    await writePage('sign', { title: '签名流程' })
    expect(await searchWiki(root, '   ')).toEqual([])
  })

  it('一页最多给 3 条正文命中', async () => {
    await writePage('many', { title: 'many', content: 'hit\nhit\nhit\nhit\nhit' })
    const hits = await searchWiki(root, 'hit')
    expect(hits).toHaveLength(3)
  })
})

describe('Wiki：本地工具', () => {
  it('提供 list / read / search / neighbors 四个工具，描述能说明什么时候用', () => {
    const tools = createWikiTools(() => root)
    expect(tools.map((tool) => tool.name)).toEqual([
      'wiki_list',
      'wiki_read',
      'wiki_search',
      'wiki_neighbors',
    ])
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('schema 标明了必填参数', () => {
    const tools = createWikiTools(() => root)
    const read = tools.find((tool) => tool.name === 'wiki_read')
    const search = tools.find((tool) => tool.name === 'wiki_search')
    expect(read?.inputSchema.required).toEqual(['slug'])
    expect(search?.inputSchema.required).toEqual(['query'])
  })

  it('wiki_list 返回页面元信息；带 parent 时只列直接子页面', async () => {
    await writePage('parent', { title: '父页' })
    await writePage('child', { title: '子页', parent: 'parent' })
    await writePage('other', { title: '无关页' })

    const list = createWikiTools(() => root).find((tool) => tool.name === 'wiki_list')
    const all = await list?.execute({})
    const parsed = JSON.parse(texts(all as CallToolResult).join('\n')) as Array<{ slug: string }>
    expect(parsed.map((page) => page.slug).sort()).toEqual(['child', 'other', 'parent'])

    const children = await list?.execute({ parent: 'parent' })
    const childPages = JSON.parse(texts(children as CallToolResult).join('\n')) as Array<{
      slug: string
    }>
    expect(childPages.map((page) => page.slug)).toEqual(['child'])
  })

  it('wiki_read 返回正文原文', async () => {
    await writePage('deploy', { title: '部署手册', content: '# 部署手册\n\n正文' })
    const read = createWikiTools(() => root).find((tool) => tool.name === 'wiki_read')
    const result = await read?.execute({ slug: 'deploy' })
    const output = texts(result as CallToolResult).join('\n')
    expect(output).toContain('# 部署手册')
    expect(output).toContain('页面信息')
  })

  it('wiki_read 缺参数 / 页面不存在时给出工具级错误', async () => {
    const read = createWikiTools(() => root).find((tool) => tool.name === 'wiki_read')
    const missing = await read?.execute({})
    expect(missing?.isError).toBe(true)

    const absent = await read?.execute({ slug: 'nope' })
    expect(absent?.isError).toBe(true)
    expect(texts(absent as CallToolResult).join('')).toContain('页面不存在')
  })

  it('wiki_search 返回命中项', async () => {
    await writePage('sign', { title: '签名流程', content: '第一步：生成密钥\n第二步：签名' })
    const search = createWikiTools(() => root).find((tool) => tool.name === 'wiki_search')
    const result = await search?.execute({ query: '第二步' })
    const hits = JSON.parse(texts(result as CallToolResult).join('\n')) as Array<{
      slug: string
      line: number
    }>
    expect(hits).toHaveLength(1)
    expect(hits[0]?.slug).toBe('sign')
    expect(hits[0]?.line).toBe(2)
  })
})

describe('Wiki：作用域', () => {
  /** 造一个限定可见页面的作用域。 */
  const scopeOf = (...slugs: string[]): Set<string> => new Set(slugs)

  it('wiki_list 只列范围内的页面', async () => {
    await writePage('visible', { title: '可见页' })
    await writePage('hidden', { title: '不可见页' })

    const list = createWikiTools(
      () => root,
      () => scopeOf('visible'),
    ).find((tool) => tool.name === 'wiki_list')
    const result = await list?.execute({})
    const parsed = JSON.parse(texts(result as CallToolResult).join('\n')) as Array<{ slug: string }>
    expect(parsed.map((page) => page.slug)).toEqual(['visible'])
  })

  it('wiki_read 越权时给出工具级错误', async () => {
    await writePage('hidden', { title: '不可见页', content: '机密内容' })
    const read = createWikiTools(
      () => root,
      () => scopeOf('other'),
    ).find((tool) => tool.name === 'wiki_read')
    const result = await read?.execute({ slug: 'hidden' })
    expect(result?.isError).toBe(true)
    expect(texts(result as CallToolResult).join('')).toContain('不在此智能体的知识范围内')
    // 关键：越权时**不能**泄露正文
    expect(texts(result as CallToolResult).join('')).not.toContain('机密内容')
  })

  it('wiki_search 只搜范围内的页面', async () => {
    await writePage('visible', { title: '可见页', content: '共同关键词' })
    await writePage('hidden', { title: '不可见页', content: '共同关键词' })

    const search = createWikiTools(
      () => root,
      () => scopeOf('visible'),
    ).find((tool) => tool.name === 'wiki_search')
    const result = await search?.execute({ query: '共同关键词' })
    const hits = JSON.parse(texts(result as CallToolResult).join('\n')) as Array<{ slug: string }>
    expect(hits.every((hit) => hit.slug === 'visible')).toBe(true)
  })

  it('没有作用域时不限制', async () => {
    await writePage('a', { title: 'A' })
    await writePage('b', { title: 'B' })
    const list = createWikiTools(() => root).find((tool) => tool.name === 'wiki_list')
    const result = await list?.execute({})
    const parsed = JSON.parse(texts(result as CallToolResult).join('\n')) as Array<{ slug: string }>
    expect(parsed).toHaveLength(2)
  })
})

describe('Wiki：图谱', () => {
  it('读出页面里的引用边', async () => {
    await writePage('a', { title: 'A', links: ['b'] })
    await writePage('b', { title: 'B' })
    const page = await readWikiPage(root, 'a')
    expect(page?.links).toEqual(['b'])
  })

  it('wiki_neighbors 报出入边、父子、同标签', async () => {
    await writePage('a', { title: 'A', links: ['b'], tags: ['运维'] })
    await writePage('b', { title: 'B', links: ['c'], tags: ['运维'] })
    await writePage('c', { title: 'C', parent: 'b' })

    const neighbors = createWikiTools(() => root).find((tool) => tool.name === 'wiki_neighbors')
    const result = await neighbors?.execute({ slug: 'b' })
    const parsed = JSON.parse(texts(result as CallToolResult).join('\n')) as {
      outgoing: string[]
      incoming: string[]
      children: string[]
      siblings: string[]
    }
    expect(parsed.outgoing).toEqual(['c'])
    expect(parsed.incoming).toEqual(['a'])
    expect(parsed.children).toEqual(['c'])
    expect(parsed.siblings).toContain('a')
  })

  it('wiki_neighbors 对越权页面报错', async () => {
    await writePage('hidden', { title: '不可见页' })
    const neighbors = createWikiTools(
      () => root,
      () => new Set<string>(),
    ).find((tool) => tool.name === 'wiki_neighbors')
    const result = await neighbors?.execute({ slug: 'hidden' })
    expect(result?.isError).toBe(true)
  })
})

describe('Wiki：检索质量', () => {
  it('中文按二元组切词，换个说法也能召回', async () => {
    // 搜「连接池」—— 文档写的是「数据库连接池配置」
    await writePage('db', { title: '数据库配置', content: '这里讲数据库连接池怎么配' })
    const hits = await searchWiki(root, '连接池')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.slug).toBe('db')
  })

  it('标题命中排在正文命中前面', async () => {
    await writePage('title-hit', { title: '回滚流程', content: '无关内容' })
    await writePage('body-hit', { title: '别的页面', content: '这里提到回滚流程' })
    const hits = await searchWiki(root, '回滚流程')
    expect(hits[0]?.slug).toBe('title-hit')
  })

  it('搜不到返回空', async () => {
    await writePage('x', { title: 'X', content: '内容' })
    expect(await searchWiki(root, '完全不相关的词')).toEqual([])
  })
})
