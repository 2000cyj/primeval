import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  neighborsOf,
  scorePage,
  search,
  tokenize,
  type WikiScope,
  type WikiScopeEntry,
} from './agentspace-extension'

/**
 * Pi 扩展的检索逻辑测试。
 *
 * 扩展会被复制到用户的项目目录里由 Pi 加载 —— 单文件、无依赖，
 * 所以这里直接 import 源码测纯函数。
 */

/** 造一个临时 wiki 目录 + 作用域。 */
function makeScope(
  pages: {
    slug: string
    title: string
    tags?: string[]
    parent?: string | null
    links?: string[]
    body?: string
  }[],
): WikiScope {
  const root = mkdtempSync(join(tmpdir(), 'agentspace-wiki-ext-'))
  const entries: WikiScopeEntry[] = pages.map((page) => {
    const dir = join(root, page.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'page.md'), page.body ?? `# ${page.title}\n`, 'utf8')
    return {
      slug: page.slug,
      title: page.title,
      tags: page.tags ?? [],
      parent: page.parent ?? null,
      links: page.links ?? [],
    }
  })
  return { wikiRoot: root, pages: entries }
}

describe('tokenize', () => {
  it('中文切成 bigram', () => {
    expect(tokenize('连接池')).toEqual(['连接', '接池'])
  })

  it('单个汉字单独成词', () => {
    expect(tokenize('库')).toEqual(['库'])
  })

  it('英文按连续字母数字切', () => {
    expect(tokenize('DB Pool v2')).toEqual(['db', 'pool', 'v2'])
  })

  it('中英混排都能切出来', () => {
    expect(tokenize('配置 DB')).toEqual(['配置', 'db'])
  })

  it('标点是分隔符', () => {
    expect(tokenize('部署，监控')).toEqual(['部署', '监控'])
  })
})

describe('scorePage', () => {
  const entry: WikiScopeEntry = {
    slug: 'a',
    title: '部署手册',
    tags: ['运维'],
    parent: null,
    links: [],
  }

  it('标题命中权重高于正文', () => {
    const titleHit = scorePage(entry, '无关内容', tokenize('部署手册'))
    const bodyHit = scorePage(entry, '这里讲了部署手册的事', tokenize('部署手册'))
    expect(titleHit).toBeGreaterThan(0)
    expect(bodyHit).toBeGreaterThan(0)
  })

  it('完全无关得 0 分', () => {
    expect(scorePage(entry, '完全无关', tokenize('数据库'))).toBe(0)
  })

  it('正文重复出现做对数衰减，不是线性累加', () => {
    const once = scorePage(entry, '部署', tokenize('部署'))
    const many = scorePage(entry, '部署'.repeat(20), tokenize('部署'))
    // 出现 20 次不该是 1 次的 20 倍
    expect(many).toBeGreaterThan(once)
    expect(many).toBeLessThan(once * 5)
  })
})

describe('search', () => {
  it('标题命中排在前面', () => {
    const scope = makeScope([
      { slug: 'a', title: '数据库连接池', body: '无关内容' },
      { slug: 'b', title: '部署手册', body: '正文里提到数据库连接池的配置' },
    ])
    const hits = search(scope, '数据库连接池', 8)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].slug).toBe('a')
  })

  it('同义/换词也能召回（bigram 兜住）', () => {
    const scope = makeScope([
      { slug: 'a', title: 'DB连接参数', body: '这里说明连接参数的设置方法' },
    ])
    // 搜「连接参数」—— 标题里有 bigram 命中
    const hits = search(scope, '连接参数', 8)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('正文命中给出行号', () => {
    const scope = makeScope([
      { slug: 'a', title: '无关标题', body: '第一行\n第二行提到回滚\n第三行' },
    ])
    const hits = search(scope, '回滚', 8)
    expect(hits[0].line).toBe(2)
    expect(hits[0].matchedIn).toBe('正文')
  })

  it('搜不到返回空', () => {
    const scope = makeScope([{ slug: 'a', title: '部署', body: 'x' }])
    expect(search(scope, '完全不相关的东西', 8)).toEqual([])
  })

  it('空查询返回空', () => {
    const scope = makeScope([{ slug: 'a', title: '部署', body: 'x' }])
    expect(search(scope, '   ', 8)).toEqual([])
  })

  it('只搜作用域内的页面', () => {
    const scope = makeScope([{ slug: 'a', title: '可见页', body: '内容' }])
    const hits = search(scope, '可见页', 8)
    expect(hits.every((hit) => hit.slug === 'a')).toBe(true)
  })
})

describe('neighborsOf', () => {
  it('报出出入边、父子、同标签', () => {
    const scope = makeScope([
      { slug: 'a', title: 'A', links: ['b'], tags: ['运维'] },
      { slug: 'b', title: 'B', links: ['c'], tags: ['运维'] },
      { slug: 'c', title: 'C', parent: 'b', tags: ['其它'] },
    ])
    const n = neighborsOf(scope, 'b', 'both')
    expect(n.outgoing).toEqual(['c'])
    expect(n.incoming).toEqual(['a'])
    expect(n.children).toEqual(['c'])
    expect(n.siblings).toContain('a')
  })

  it('direction=out 不返回入边', () => {
    const scope = makeScope([
      { slug: 'a', title: 'A', links: ['b'] },
      { slug: 'b', title: 'B' },
    ])
    const n = neighborsOf(scope, 'b', 'out')
    expect(n.incoming).toEqual([])
    expect(n.outgoing).toEqual([])
  })

  it('方向=in 时不带子页面', () => {
    const scope = makeScope([
      { slug: 'a', title: 'A' },
      { slug: 'b', title: 'B', parent: 'a' },
    ])
    const n = neighborsOf(scope, 'a', 'in')
    expect(n.children).toEqual([])
  })

  it('引用了范围外的页面时不返回它', () => {
    const scope = makeScope([{ slug: 'a', title: 'A', links: ['范围外的页面'] }])
    const n = neighborsOf(scope, 'a', 'both')
    expect(n.outgoing).toEqual([])
  })
})
