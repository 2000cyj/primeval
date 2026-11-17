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
import { agentsDir, wikiDir } from './config.ts'
import { searchPages, type SearchHit } from './wiki-search.ts'

/** 正文文件名 */
const PAGE_FILE = 'page.md'

/** 元信息文件名 */
const META_FILE = '.meta.json'

/** 正文读取上限 —— 防止一篇超长文档把 agent 的上下文撑爆。 */
const MAX_CONTENT_CHARS = 20000

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
  /** 本页引用的其它页面（正文里的 `[[引用]]`）。 */
  links: string[]
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

/** 一个页面的关联页面（知识图谱的邻接关系）。 */
export type WikiNeighbors = {
  /** 页面 slug。 */
  slug: string
  /** 本页引用的页面（出边）。 */
  outgoing: string[]
  /** 引用了本页的页面（入边）。 */
  incoming: string[]
  /** 父页面。 */
  parent: string | null
  /** 直接子页面。 */
  children: string[]
  /** 同标签的其它页面。 */
  siblings: string[]
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
  const rawLinks = Array.isArray(record['links']) ? record['links'] : []
  const createdAt = record['createdAt']
  const updatedAt = record['updatedAt']

  return {
    slug,
    // 标题为空就用 slug 顶上 —— agent 至少能认出这是哪一页
    title: title.trim() === '' ? slug : title,
    tags: rawTags.filter((tag): tag is string => typeof tag === 'string'),
    parent: typeof rawParent === 'string' && rawParent.trim() !== '' ? rawParent : null,
    links: rawLinks.filter((link): link is string => typeof link === 'string'),
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
// （snippetOf 从 wiki-search.ts 来，两边实现必须一致）

/**
 * 搜索标题和正文。
 *
 * 中文用 bigram 分词、英文按词切，命中后按得分排序
 * —— 标题命中权重最高，正文命中给出行号与片段。
 *
 * `scope` 传了就只搜范围内的页面。
 */
export async function searchWiki(
  root: string,
  query: string,
  scope?: Set<string> | null,
): Promise<WikiSearchHit[]> {
  const metas = await listWikiPages(root)
  const pages = []
  for (const meta of metas) {
    if (scope && !scope.has(meta.slug)) continue
    const page = await readWikiPage(root, meta.slug)
    if (!page) continue
    pages.push({
      slug: page.slug,
      title: page.title,
      tags: page.tags,
      content: page.content,
    })
  }
  const hits: SearchHit[] = searchPages(pages, query, Number.MAX_SAFE_INTEGER)
  return hits.map((hit) => ({
    slug: hit.slug,
    title: hit.title,
    snippet: hit.snippet,
    line: hit.line,
  }))
}

/**
 * 某页面的邻居。
 *
 * 边的来源：`parent`（树形层级）、`links`（正文里的 `[[引用]]`）、`tags`（同标签）。
 */
export async function wikiNeighbors(
  root: string,
  slug: string,
  scope?: Set<string> | null,
): Promise<WikiNeighbors | null> {
  const page = await readWikiPage(root, slug)
  if (!page) return null
  const all = await listWikiPages(root)
  const visible = (target: string): boolean => !scope || scope.has(target)

  const outgoing = page.links.filter((link) => visible(link))
  const incoming = all
    .filter((meta) => meta.slug !== slug && meta.links.includes(slug) && visible(meta.slug))
    .map((meta) => meta.slug)
  const children = all
    .filter((meta) => meta.parent === slug && visible(meta.slug))
    .map((meta) => meta.slug)
  const siblings = all
    .filter(
      (meta) =>
        meta.slug !== slug &&
        visible(meta.slug) &&
        page.tags.length > 0 &&
        meta.tags.some((tag) => page.tags.includes(tag)),
    )
    .map((meta) => meta.slug)

  return {
    slug,
    outgoing,
    incoming,
    parent: page.parent && visible(page.parent) ? page.parent : null,
    children,
    siblings,
  }
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
function wikiListTool(root: () => string, scope: () => Set<string> | null): LocalTool {
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
      const allowed = scope()
      const pages = (await listWikiPages(root())).filter(
        (page) => !allowed || allowed.has(page.slug),
      )
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
function wikiReadTool(root: () => string, scope: () => Set<string> | null): LocalTool {
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
      const allowed = scope()
      if (allowed && !allowed.has(slug)) {
        return errorResult(`页面不在此智能体的知识范围内：${slug}`)
      }
      const page = await readWikiPage(root(), slug)
      if (!page) {
        return errorResult(`页面不存在：${slug}`)
      }
      const { content, ...meta } = page
      const truncated = content.length > MAX_CONTENT_CHARS
      const body = truncated ? content.slice(0, MAX_CONTENT_CHARS) : content
      const note = truncated
        ? `\n\n（正文超过 ${MAX_CONTENT_CHARS} 字符，已截断。用 wiki_search 定位需要的段落。）`
        : ''
      return {
        content: [
          { type: 'text', text: `页面信息：${JSON.stringify(meta)}` },
          { type: 'text', text: `${body}${note}` },
        ],
      }
    },
  }
}

/** 搜索页面的工具 */
function wikiSearchTool(root: () => string, scope: () => Set<string> | null): LocalTool {
  return {
    name: 'wiki_search',
    description:
      '在 AgentSpace 内置 Wiki 里搜索关键词，同时搜标题和正文（中文按二元组切词），' +
      '返回命中页面的 slug、标题、片段与行号，按相关度排序。想知道「某个词在哪一页」时用它，再用 wiki_read 读全文。',
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
      const hits = await searchWiki(root(), query, scope())
      return textResult(JSON.stringify(hits, null, 2))
    },
  }
}

/** 查关联页面的工具 */
function wikiNeighborsTool(root: () => string, scope: () => Set<string> | null): LocalTool {
  return {
    name: 'wiki_neighbors',
    description:
      '查 Wiki 里某个页面的关联页面：它引用的、引用它的、父子页面、同标签页面。' +
      '用来顺着知识图谱扩展阅读范围 —— 读到一个页面后想知道还应该看什么时用它。',
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
      const allowed = scope()
      if (allowed && !allowed.has(slug)) {
        return errorResult(`页面不在此智能体的知识范围内：${slug}`)
      }
      const result = await wikiNeighbors(root(), slug, allowed)
      if (!result) {
        return errorResult(`页面不存在：${slug}`)
      }
      return textResult(JSON.stringify(result, null, 2))
    },
  }
}

/**
 * 读某个智能体的 wiki 作用域。
 *
 * 作用域来自 `~/.agent-compose/agents/<id>/agent.json` 里的 `wikiPages` ——
 * 绑定的是**入口页面**，整棵子树自动跟着可见。
 *
 * 返回 `null` = 不限制（没传 agent id，或智能体没绑 wiki）。
 *
 * 注意目录：这里用 `agentsDir()` 而不是 `appDataDir()` ——
 * core 侧写 agent.json 用的是**固定的** `~/.agent-compose`，
 * 不受 `AGENT_COMPOSE_DATA_DIR` 影响。两边必须读同一个地方，
 * 否则 scope 算出来是空的。
 */
export async function resolveWikiScope(agentId: string): Promise<Set<string> | null> {
  if (!agentId.trim() || agentId.includes('/') || agentId.includes('\\')) {
    // id 会拼进文件路径 —— 挡住路径穿越
    return null
  }
  let raw: string
  try {
    raw = await readFile(join(agentsDir(), agentId, 'agent.json'), 'utf8')
  } catch {
    return null
  }
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(doc)) return null
  const refs = doc['wikiPages']
  if (!Array.isArray(refs)) return null
  const roots = refs.filter((ref): ref is string => typeof ref === 'string')
  if (roots.length === 0) return null

  const pages = await listWikiPages(wikiDir())
  const known = new Set(pages.map((page) => page.slug))
  const childrenOf = new Map<string, string[]>()
  for (const page of pages) {
    if (!page.parent) continue
    const list = childrenOf.get(page.parent) ?? []
    list.push(page.slug)
    childrenOf.set(page.parent, list)
  }

  const scope = new Set<string>()
  const queue: string[] = []
  for (const ref of roots) {
    const bare = ref.replace(/^wiki\//, '').trim()
    if (!bare || !known.has(bare) || scope.has(bare)) continue
    scope.add(bare)
    queue.push(bare)
  }
  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const child of childrenOf.get(current) ?? []) {
      if (scope.has(child)) continue
      scope.add(child)
      queue.push(child)
    }
  }
  return scope
}

/**
 * 造出 Wiki 本地工具。
 *
 * root 是个函数而不是字符串 —— 每次调用时才解析目录，
 * 这样 AGENT_COMPOSE_DATA_DIR 之类的覆盖在运行期也生效。
 *
 * scope 传了就只让 agent 看范围内的页面（按 agent 的 wiki 绑定展开）。
 */
export function createWikiTools(
  root: () => string = () => wikiDir(),
  scope: () => Set<string> | null = () => null,
): LocalTool[] {
  return [
    wikiListTool(root, scope),
    wikiReadTool(root, scope),
    wikiSearchTool(root, scope),
    wikiNeighborsTool(root, scope),
  ]
}
