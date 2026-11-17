/**
 * agentspace 的 Pi 扩展。
 *
 * 两件事：
 *
 * 1. 把 `.pi/AGENTS.md`（智能体指令）注入 system prompt。
 *
 * 2. 注册 wiki 工具，让 agent 能检索内部知识库。
 *
 * ── 为什么知识库分两层 ─────────────────────────────────
 *
 * 指令里只注入页面的**标题 / slug / 标签**，正文不注入；
 * 正文由 agent 自己调 `wiki_read` 拉。
 *
 * 这跟 skill 的处理是同一个哲学 —— 只告诉 agent「有什么」，
 * 「内容是什么」让它自己去拿。全部正文一次性灌进 prompt
 * 会把上下文吃光，而且 agent 根本不知道该看哪一篇。
 *
 * ── 作用域从哪来 ───────────────────────────────────────
 *
 * `.pi/wiki-scope.json`（prepare.rs 写的）里有这个智能体
 * **能看到哪些页面**。作用域跟着工作目录走 —— 天然按项目隔离，
 * 扩展不用知道自己正在为哪个智能体服务。
 *
 * 页面正文不在作用域文件里 —— 只在需要时按需读 `page.md`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * 项目配置目录名。
 *
 * **故意写死，不从 Pi 拿**（Pi 文档建议用 `CONFIG_DIR_NAME`）：
 * - 扩展是**单文件**、零运行时依赖的 —— 只 import 类型（编译期就抹掉了），
 *   运行时不碰 Pi 的模块映射，Pi 换版本也不会加载失败；
 * - AgentSpace 整套东西本来就写死了 `.pi`（CLI 侧 `pi.rs` 也是 `cwd.join(".pi")`），
 *   两边不一致的话更麻烦。
 */
const CONFIG_DIR = '.pi'

/** 作用域文件里的一个页面条目。 */
export type WikiScopeEntry = {
  slug: string
  title: string
  tags: string[]
  parent: string | null
  links: string[]
}

/** 作用域文件的内容。 */
export type WikiScope = {
  wikiRoot: string
  pages: WikiScopeEntry[]
}

/** 正文的读取上限 —— 防止一篇超长文档把上下文撑爆。 */
const MAX_CONTENT_CHARS = 20000

/** 搜索片段的最大字符数。 */
const SNIPPET_MAX_CHARS = 120

/** 一页最多给几条正文命中（免得同一页刷屏）。 */
const MAX_HITS_PER_PAGE = 3

// ─────────────────────────────────────────────────────────
// 作用域
// ─────────────────────────────────────────────────────────

/** 作用域缓存 —— 按工作目录缓存，读一次就够。 */
const scopeCache = new Map<string, WikiScope | null>()

/** 读作用域文件。
 *
 * 读不到 / 解析不了 → `null`（这个智能体没绑知识库）。
 * **解析失败不能抛** —— 一个坏文件不该把整个 agent 拖垮。
 */
function loadScope(cwd: string): WikiScope | null {
  const cached = scopeCache.get(cwd)
  if (cached !== undefined) return cached

  let scope: WikiScope | null = null
  const path = join(cwd, CONFIG_DIR, 'wiki-scope.json')
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (raw && Array.isArray(raw.pages) && typeof raw.wikiRoot === 'string') {
        scope = { wikiRoot: raw.wikiRoot, pages: raw.pages }
      }
    }
  } catch {
    scope = null
  }
  scopeCache.set(cwd, scope)
  return scope
}

/** 某个 slug 在不在作用域内。 */
function isVisible(scope: WikiScope | null, slug: string): boolean {
  if (!scope) return false
  return scope.pages.some((page) => page.slug === slug)
}

/** 读页面正文。读不到返回空串。 */
function readContent(scope: WikiScope, slug: string): string {
  try {
    return readFileSync(join(scope.wikiRoot, slug, 'page.md'), 'utf8')
  } catch {
    return ''
  }
}

// ─────────────────────────────────────────────────────────
// 检索
// ─────────────────────────────────────────────────────────

/** 把文本切成检索用的 token。
 *
 * 中文不分词 —— 用 bigram：「连接池」→「连接」「接池」。
 * 召回会变宽，但配合打分排序够用，而且零依赖。
 * 英文/数字按连续字母数字切。
 *
 * 导出是为了能单测 —— 里面的分词逻辑是整个检索的地基。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let latin = ''
  let cjk = ''

  const flushLatin = (): void => {
    if (latin) {
      tokens.push(latin)
      latin = ''
    }
  }
  const flushCjk = (): void => {
    if (cjk.length === 1) {
      tokens.push(cjk)
    } else {
      for (let i = 0; i + 1 < cjk.length; i += 1) tokens.push(cjk.slice(i, i + 2))
    }
    cjk = ''
  }

  for (const ch of text.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) {
      flushCjk()
      latin += ch
    } else if (ch >= '\u4e00' && ch <= '\u9fff') {
      flushLatin()
      cjk += ch
    } else {
      flushLatin()
      flushCjk()
    }
  }
  flushLatin()
  flushCjk()
  return tokens
}

/** 命中得分。
 *
 * 标题权重最高 —— 标题是作者对「这页讲什么」的显式总结。
 * 标签次之。正文最低。
 *
 * 正文按出现次数累加，但做对数衰减：同一个词出现 10 次，
 * 不该比出现 1 次重要 10 倍。
 */
export function scorePage(entry: WikiScopeEntry, content: string, queryTokens: string[]): number {
  const titleTokens = new Set(tokenize(`${entry.title} ${entry.tags.join(' ')}`))
  const bodyTokens = tokenize(content)
  const bodyCount = new Map<string, number>()
  for (const token of bodyTokens) {
    bodyCount.set(token, (bodyCount.get(token) ?? 0) + 1)
  }

  let score = 0
  for (const token of queryTokens) {
    if (titleTokens.has(token)) score += 4
    const count = bodyCount.get(token)
    if (count) score += 1 + Math.log(count)
  }
  return score
}

/** 命中行的片段 —— 太长的行截中间。 */
function snippetOf(line: string): string {
  const trimmed = line.trim()
  const chars = [...trimmed]
  if (chars.length <= SNIPPET_MAX_CHARS) return trimmed
  const start = Math.max(0, Math.floor(chars.length / 2) - 30)
  const end = Math.min(chars.length, start + 60)
  return `…${chars.slice(start, end).join('')}…`
}

/** 搜索结果。 */
export type WikiHit = {
  slug: string
  title: string
  score: number
  snippet: string
  line: number
  /** 命中位置：标题 / 标签 / 正文。 */
  matchedIn: string
}

/** 在作用域内搜索。
 *
 * 只搜作用域里的页面 —— 越权的页面连内容都读不到。
 */
export function search(scope: WikiScope, query: string, limit: number): WikiHit[] {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return []

  const hits: WikiHit[] = []
  for (const entry of scope.pages) {
    const content = readContent(scope, entry.slug)
    const score = scorePage(entry, content, queryTokens)
    if (score <= 0) continue

    // 标题命中就直接给标题当片段 —— 不必再找正文行
    const titleTokens = new Set(tokenize(`${entry.title} ${entry.tags.join(' ')}`))
    const titleHit = queryTokens.some((token) => titleTokens.has(token))
    if (titleHit) {
      hits.push({
        slug: entry.slug,
        title: entry.title,
        score,
        snippet: entry.title,
        line: 1,
        matchedIn: '标题',
      })
      continue
    }

    // 正文命中 —— 给行号和片段，一页最多 3 条
    let count = 0
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const lineTokens = new Set(tokenize(line))
      if (!queryTokens.some((token) => lineTokens.has(token))) continue
      hits.push({
        slug: entry.slug,
        title: entry.title,
        score,
        snippet: snippetOf(line),
        line: index + 1,
        matchedIn: '正文',
      })
      count += 1
      if (count >= MAX_HITS_PER_PAGE) break
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, Math.max(1, limit))
}

/** 某页面的邻居。 */
export function neighborsOf(
  scope: WikiScope,
  slug: string,
  direction: 'out' | 'in' | 'both',
): {
  outgoing: string[]
  incoming: string[]
  parent: string | null
  children: string[]
  siblings: string[]
} {
  const entry = scope.pages.find((page) => page.slug === slug)
  const visible = new Set(scope.pages.map((page) => page.slug))
  const outgoing = (entry?.links ?? []).filter((link) => visible.has(link))
  const incoming = scope.pages
    .filter((page) => page.slug !== slug && page.links.includes(slug))
    .map((page) => page.slug)
  const children = scope.pages.filter((page) => page.parent === slug).map((page) => page.slug)
  const siblings = entry
    ? scope.pages
        .filter((page) => page.slug !== slug && page.tags.some((tag) => entry.tags.includes(tag)))
        .map((page) => page.slug)
    : []

  const out = direction === 'in' ? [] : outgoing
  const inc = direction === 'out' ? [] : incoming
  return {
    outgoing: out,
    incoming: inc,
    parent: entry?.parent ?? null,
    children: direction === 'in' ? [] : children,
    siblings: direction === 'in' ? [] : siblings,
  }
}

// ─────────────────────────────────────────────────────────
// 扩展入口
// ─────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const dir = join(ctx.cwd, CONFIG_DIR)
    const overridePath = join(dir, 'AGENTS.override.md')
    const mainPath = join(dir, 'AGENTS.md')

    // 和 Pi 一样的语义：override 存在就顶掉 AGENTS.md
    const path = existsSync(overridePath) ? overridePath : mainPath
    if (!existsSync(path)) return

    let content: string
    try {
      content = readFileSync(path, 'utf8')
    } catch {
      // 读不到就当没这个文件，不该把整个 agent 拖垮
      return
    }
    if (!content.trim()) return

    const files = event.systemPromptOptions.contextFiles
    const existing = files.find((file) => file.path === path)
    if (existing) {
      // 同一轮里重复触发时刷新内容，不重复挂载
      existing.content = content
      return
    }
    files.push({ path, content })
  })

  // ── 知识库工具 ───────────────────────────────────────
  //
  // 只在**有作用域**时才注册 —— 没绑知识库的智能体，
  // 不该在 prompt 里背这三个工具的描述。
  const initialScope = loadScope(process.cwd())
  if (!initialScope || initialScope.pages.length === 0) return

  pi.registerTool({
    name: 'wiki_search',
    label: 'Wiki搜索',
    description:
      '在内部知识库（AgentSpace Wiki）中检索。混合全文与语义匹配，按相关度排序，返回命中页面的 slug、标题、片段与行号。' +
      '回答内部流程、约定、历史决策类问题前，先用它找到相关页面，再用 wiki_read 读全文。',
    // 工具清单里的一句话说明 —— 不给的话，Pi 不会把这个工具列进
    // system prompt 的「可用工具」段，agent 就不知道它存在。
    promptSnippet: '在内部知识库（Wiki）里检索页面',
    // 工具激活时追加的规则条 —— 这是让 agent 主动去查知识库的关键。
    // 光有工具不够：agent 很可能压根想不到该用它。
    promptGuidelines: [
      '回答涉及内部流程、约定、历史决策、配置细节的问题前，先用 wiki_search 检索内部知识库；命中后用 wiki_read 读全文再作答。',
    ],
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或问题' },
        limit: { type: 'number', description: '返回条数，默认 8' },
      },
      required: ['query'],
    },
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = loadScope(ctx.cwd)
      if (!scope || scope.pages.length === 0) {
        return { content: [{ type: 'text', text: '这个智能体没有绑定知识库。' }], details: {} }
      }
      const query = typeof params.query === 'string' ? params.query : ''
      const limit = typeof params.limit === 'number' ? params.limit : 8
      const hits = search(scope, query, limit)
      if (hits.length === 0) {
        return {
          content: [{ type: 'text', text: `没有找到与「${query}」相关的页面。` }],
          details: { count: 0 },
        }
      }
      const lines = hits.map(
        (hit) =>
          `- ${hit.title}（slug: ${hit.slug}，命中${hit.matchedIn}第 ${hit.line} 行）：${hit.snippet}`,
      )
      return {
        content: [
          {
            type: 'text',
            text: `找到 ${hits.length} 条相关页面：\n${lines.join('\n')}\n\n用 wiki_read(slug) 读全文。`,
          },
        ],
        details: { count: hits.length },
      }
    },
  })

  pi.registerTool({
    name: 'wiki_read',
    label: 'Wiki读取',
    description:
      '读取内部知识库中某个页面的正文（Markdown 原文）。先用 wiki_search 找到 slug 再读。只读，不会改动任何内容。',
    promptSnippet: '读内部知识库某个页面的正文',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '页面 slug（wiki_search 的返回值）' },
      },
      required: ['slug'],
    },
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = loadScope(ctx.cwd)
      if (!scope || scope.pages.length === 0) {
        return { content: [{ type: 'text', text: '这个智能体没有绑定知识库。' }], details: {} }
      }
      const slug = typeof params.slug === 'string' ? params.slug.trim() : ''
      if (!slug) {
        return { content: [{ type: 'text', text: '缺少参数：slug（页面标识）' }], details: {} }
      }
      if (!isVisible(scope, slug)) {
        return {
          content: [{ type: 'text', text: `页面不在此智能体的知识范围内：${slug}` }],
          details: {},
        }
      }
      const entry = scope.pages.find((page) => page.slug === slug)
      const raw = readContent(scope, slug)
      const truncated = raw.length > MAX_CONTENT_CHARS
      const content = truncated ? raw.slice(0, MAX_CONTENT_CHARS) : raw
      const note = truncated
        ? `\n\n（正文超过 ${MAX_CONTENT_CHARS} 字符，已截断。用 wiki_search 定位需要的段落。）`
        : ''
      return {
        content: [
          {
            type: 'text',
            text: `页面：${entry?.title ?? slug}（slug: ${slug}）\n${content}${note}`,
          },
        ],
        details: { slug, truncated },
      }
    },
  })

  pi.registerTool({
    name: 'wiki_neighbors',
    label: 'Wiki关联',
    description:
      '查内部知识库里某个页面的关联页面：它引用的、引用它的、父子页面、同标签页面。' +
      '用来顺着知识图谱扩展阅读范围 —— 读到一个页面后想知道还应该看什么时用它。',
    promptSnippet: '查知识库里某个页面的关联页面',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '页面 slug' },
        direction: {
          type: 'string',
          enum: ['out', 'in', 'both'],
          description: '方向：out=它引用的，in=引用它的，both=都要',
        },
      },
      required: ['slug'],
    },
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = loadScope(ctx.cwd)
      if (!scope || scope.pages.length === 0) {
        return { content: [{ type: 'text', text: '这个智能体没有绑定知识库。' }], details: {} }
      }
      const slug = typeof params.slug === 'string' ? params.slug.trim() : ''
      if (!slug) {
        return { content: [{ type: 'text', text: '缺少参数：slug（页面标识）' }], details: {} }
      }
      if (!isVisible(scope, slug)) {
        return {
          content: [{ type: 'text', text: `页面不在此智能体的知识范围内：${slug}` }],
          details: {},
        }
      }
      const direction =
        params.direction === 'out' || params.direction === 'in' ? params.direction : 'both'
      const result = neighborsOf(scope, slug, direction)
      const titleOf = (target: string): string =>
        scope.pages.find((page) => page.slug === target)?.title ?? target
      const line = (label: string, list: string[]): string =>
        list.length === 0 ? '' : `${label}：${list.map(titleOf).join('、')}\n`
      const text =
        `页面「${titleOf(slug)}」的关联：\n` +
        line('引用的页面', result.outgoing) +
        line('被引用的页面', result.incoming) +
        line('子页面', result.children) +
        line('同标签页面', result.siblings)
      return { content: [{ type: 'text', text: text.trim() }], details: { slug } }
    },
  })
}
