/**
 * 内置 Wiki 的本地工具：让 agent 直接读 AgentSpace 的本地 Markdown 知识库。
 *
 * Wiki 落在 app 数据目录下（目录由 config.ts 的 wikiDir 给出）：
 *
 * ```text
 * <root>/<slug>/page.md      正文（Markdown 源码）
 * <root>/<slug>/.meta.json   { title, tags, parent, createdAt, updatedAt }
 * ```
 *
 * 布局与桌面端 Rust 侧（apps/agentspace-core/src/wiki.rs）一致 ——
 * 两边读写同一批文件，改布局必须同步改那边。
 *
 * 这三个工具是**本地工具**：不来自任何上游 MCP server，直接读本机文件，
 * 因此不走 registry 的转发链路（session.ts 里单独路由）。
 */
import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/client'
import type { LocalTool } from './session.ts'
import { wikiDir } from './config.ts'

/** 正文文件名 */
const PAGE_FILE = 'page.md'

/** 元信息文件名 */
const META_FILE = '.meta.json'

/** 命中片段的最大字符数（超了截中间，前后加省略号） */
const SNIPPET_MAX_CHARS = 120

/** 一页最多给几条正文命中（免得一大段重复内容刷屏） */
const MAX_HITS_PER_PAGE = 3

/** 一个页面的元信息（与 Rust 侧的 WikiPageMeta 对齐） */
export type WikiPageMeta = {
  /** 唯一标识（目录名） */
  slug: string
  /** 标题 */
  title: string
  /** 标签 */
  tags: string[]
  /** 父页面 slug；null = 顶层 */
  parent: string | null
  /** 创建时间（epoch 毫秒） */
  createdAt: number
  /** 最后修改时间（epoch 毫秒） */
  updatedAt: number
}

/** 一个页面（含正文） */
export type WikiPage = WikiPageMeta & {
  /** 正文（Markdown 源码） */
  content: string
}

/** 搜索命中 */
export type WikiSearchHit = {
  /** 页面 slug */
  slug: string
  /** 页面标题 */
  title: string
  /** 命中行附近的文本片段 */
  snippet: string
  /** 命中的行号（从 1 开始） */
  line: number
}

/** 判断是不是普通对象（解析 JSON 后的元信息可能什么都得有） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把 `.meta.json` 的内容归一化成 WikiPageMeta。
 *
 * 元信息是**可选**的：文件可能不存在、可能写坏了、可能是老版本只有几个字段。
 * 这时不能报错 —— 页面正文还在，就说明页面存在，元信息缺的部分用默认值补。
 */
function normalizeMeta(raw: unknown, slug: string): WikiPageMeta {
  const record = isRecord(raw) ? raw : {}
  const title = typeof record['title'] === 'string' ? record['title'] : ''
  const rawTags = Array.isArray(record['tags']) ? record['tags'] : []
  const rawParent = record['parent']
  const createdAt = record['createdAt']
  const updatedAt = record['updatedAt']

  return {
    slug,
    // 标题为空就用 slug 顶上 —— agent 至少能认出这是哪一页
    title: title.trim() === '' ? slug : title,
    tags: rawTags.filter((tag): tag is string => typeof tag === 'string'),
    parent: typeof rawParent === 'string' && rawParent.trim() !== '' ? rawParent : null,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : 0,
  }
}

/** 读一页的元信息；读不到就当没有（返回 null） */
async function readMeta(dir: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, META_FILE), 'utf8'))
  } catch {
    return null
  }
}

/** 路径是不是一个文件 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * slug 能不能当目录名用。
 *
 * slug 是 agent 传进来的，必须挡住路径穿越（`../../`），
 * 否则 agent 能读到 wiki 目录之外的文件。
 */
export function isSafeSlug(slug: string): boolean {
  if (slug.trim() === '') return false
  if (slug.includes('/') || slug.includes('\\') || slug.includes('\0')) return false
  return slug !== '.' && slug !== '..'
}

/**
 * 列出 wiki 里的全部页面（按标题排序）。
 *
 * wiki 目录还不存在时返回空列表 —— 不是错误：
 * 用户可能还没建过 Wiki，agent 不该因此报错。
 */
export async function listWikiPages(root: string): Promise<WikiPageMeta[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const pages: WikiPageMeta[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    // 只有带正文的目录才算页面 —— 半成品目录不进列表
    if (!(await isFile(join(dir, PAGE_FILE)))) continue
    pages.push(normalizeMeta(await readMeta(dir), entry.name))
  }

  pages.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
  return pages
}

/**
 * 读一个页面（含正文）。页面不存在返回 null。
 */
export async function readWikiPage(root: string, slug: string): Promise<WikiPage | null> {
  if (!isSafeSlug(slug)) return null
  const dir = join(root, slug)
  let content: string
  try {
    content = await readFile(join(dir, PAGE_FILE), 'utf8')
  } catch {
    return null
  }
  const meta = normalizeMeta(await readMeta(dir), slug)
  return { ...meta, content }
}

/** 命中行的片段 —— 太长的行截中间，前后加省略号 */
function snippetOf(line: string): string {
  const trimmed = line.trim()
  const chars = [...trimmed]
  if (chars.length <= SNIPPET_MAX_CHARS) return trimmed
  const start = Math.max(0, Math.floor(chars.length / 2) - 30)
  const end = Math.min(chars.length, start + 60)
  return `…${chars.slice(start, end).join('')}…`
}

/**
 * 搜索标题和正文。
 *
 * 规则与桌面端一致：大小写不敏感的子串匹配；标题命中优先（且不再看正文），
 * 正文命中给出行号与片段，一页最多 3 条。
 */
export async function searchWiki(root: string, query: string): Promise<WikiSearchHit[]> {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const hits: WikiSearchHit[] = []
  for (const meta of await listWikiPages(root)) {
    if (meta.title.toLowerCase().includes(needle)) {
      hits.push({ slug: meta.slug, title: meta.title, snippet: meta.title, line: 1 })
      continue
    }
    const page = await readWikiPage(root, meta.slug)
    if (!page) continue

    let count = 0
    const lines = page.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (!line.toLowerCase().includes(needle)) continue
      hits.push({ slug: meta.slug, title: meta.title, snippet: snippetOf(line), line: index + 1 })
      count += 1
      if (count >= MAX_HITS_PER_PAGE) break
    }
  }
  return hits
}

/** 纯文本的工具结果 */
function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/** 工具级错误（不是协议级错误 —— agent 会话不能因此崩） */
function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** 列出页面的工具 */
function wikiListTool(root: () => string): LocalTool {
  return {
    name: 'wiki_list',
    description:
      '列出 AgentSpace 内置 Wiki 的页面目录，返回每个页面的 slug、标题、标签、父页面与创建/修改时间。' +
      '想知道「有哪些知识」「某个页面下有哪些子页面」时先用它，拿到 slug 之后再用 wiki_read 读正文。' +
      '不传参数时列出全部页面；传 parent 时只列出该页面的直接子页面（传空字符串表示只要顶层页面）。',
    inputSchema: {
      type: 'object',
      properties: {
        parent: {
          type: 'string',
          description:
            '可选。只列出这个 slug 的直接子页面；传空字符串表示只要顶层页面。不传则列出全部页面。',
        },
      },
    },
    execute: async (args) => {
      const parent = args['parent']
      const pages = await listWikiPages(root())
      const filtered =
        typeof parent === 'string'
          ? parent.trim() === ''
            ? pages.filter((page) => page.parent === null)
            : pages.filter((page) => page.parent === parent)
          : pages
      return textResult(JSON.stringify(filtered, null, 2))
    },
  }
}

/** 读页面正文的工具 */
function wikiReadTool(root: () => string): LocalTool {
  return {
    name: 'wiki_read',
    description:
      '读取 AgentSpace 内置 Wiki 中某个页面的正文，返回 Markdown 原文与页面信息（标题、标签、父页面、时间）。' +
      '先用 wiki_list 或 wiki_search 拿到 slug 再读。只读，不会改动任何内容。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '页面 slug（wiki_list / wiki_search 的返回值）',
        },
      },
      required: ['slug'],
    },
    execute: async (args) => {
      const slug = args['slug']
      if (typeof slug !== 'string' || slug.trim() === '') {
        return errorResult('缺少参数：slug（页面标识）')
      }
      if (!isSafeSlug(slug)) {
        return errorResult(`非法的页面标识：${slug}`)
      }
      const page = await readWikiPage(root(), slug)
      if (!page) {
        return errorResult(`页面不存在：${slug}`)
      }
      const { content, ...meta } = page
      return {
        content: [
          { type: 'text', text: `页面信息：${JSON.stringify(meta)}` },
          { type: 'text', text: content },
        ],
      }
    },
  }
}

/** 搜索页面的工具 */
function wikiSearchTool(root: () => string): LocalTool {
  return {
    name: 'wiki_search',
    description:
      '在 AgentSpace 内置 Wiki 里搜索关键词，同时搜标题和正文（大小写不敏感的子串匹配），' +
      '返回命中页面的 slug、标题、片段与行号。想知道「某个词在哪一页」时用它，再用 wiki_read 读全文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要搜索的关键词',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = args['query']
      if (typeof query !== 'string' || query.trim() === '') {
        return errorResult('缺少参数：query（搜索关键词）')
      }
      const hits = await searchWiki(root(), query)
      return textResult(JSON.stringify(hits, null, 2))
    },
  }
}

/**
 * 造出三个 Wiki 本地工具。
 *
 * root 是个函数而不是字符串 —— 每次调用时才解析目录，
 * 这样 AGENT_COMPOSE_DATA_DIR 之类的覆盖在运行期也生效。
 */
export function createWikiTools(root: () => string = () => wikiDir()): LocalTool[] {
  return [wikiListTool(root), wikiReadTool(root), wikiSearchTool(root)]
}
