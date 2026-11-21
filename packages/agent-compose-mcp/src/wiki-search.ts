/**
 * Wiki 检索的共用逻辑。
 *
 * 跟 `apps/agentspace-core/assets/agentspace-extension.ts` 里的同名逻辑
 * **必须保持一致** —— 那边是 Pi 扩展（单文件、零依赖，不能 import 本包），
 * 所以只能各写一份，用 `scripts/wiki-e2e.mts` 这个契约测试盯着两边不漂移。
 *
 * 改这边记得改那边，并跑一次那个脚本。
 */

/** 命中片段的最大字符数（超了截中间，前后加省略号）。 */
export const SNIPPET_MAX_CHARS = 120

/** 一页最多给几条正文命中（免得一大段重复内容刷屏）。 */
export const MAX_HITS_PER_PAGE = 3

/** 把文本切成检索用的 token。
 *
 * 中文不分词 —— 用 bigram：「连接池」→「连接」「接池」。
 * 召回会变宽，但配合打分排序够用，而且零依赖。
 * 英文/数字按连续字母数字切。
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

/** 打分时要看的页面信息。 */
export type ScorablePage = {
  /** 页面标题。 */
  title: string
  /** 标签。 */
  tags: string[]
}

/** 命中得分。
 *
 * 标题权重最高 —— 标题是作者对「这页讲什么」的显式总结。
 * 标签次之。正文最低。
 *
 * 正文按出现次数累加，但做对数衰减：同一个词出现 10 次，
 * 不该比出现 1 次重要 10 倍。
 */
export function scorePage(page: ScorablePage, content: string, queryTokens: string[]): number {
  const titleTokens = new Set(tokenize(`${page.title} ${page.tags.join(' ')}`))
  const bodyCount = new Map<string, number>()
  for (const token of tokenize(content)) {
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

/** 命中行的片段 —— 太长的行截中间，前后加省略号。 */
export function snippetOf(line: string): string {
  const trimmed = line.trim()
  const chars = [...trimmed]
  if (chars.length <= SNIPPET_MAX_CHARS) return trimmed
  const start = Math.max(0, Math.floor(chars.length / 2) - 30)
  const end = Math.min(chars.length, start + 60)
  return `…${chars.slice(start, end).join('')}…`
}

/** 一条搜索命中。 */
export type SearchHit = {
  /** 页面 slug。 */
  slug: string
  /** 页面标题。 */
  title: string
  /** 命中得分。 */
  score: number
  /** 命中片段。 */
  snippet: string
  /** 命中行号（从 1 开始）。 */
  line: number
  /** 命中位置：标题 / 正文。 */
  matchedIn: string
}

/** 参与检索的页面。 */
export type SearchablePage = ScorablePage & {
  /** 页面 slug。 */
  slug: string
  /** 正文（Markdown 源码）。 */
  content: string
}

/** 在一组页面里搜索。
 *
 * 标题命中就直接给标题当片段 —— 不必再找正文行。
 * 正文命中给行号和片段，一页最多 3 条。
 */
export function searchPages(pages: SearchablePage[], query: string, limit: number): SearchHit[] {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return []

  const hits: SearchHit[] = []
  for (const page of pages) {
    const score = scorePage(page, page.content, queryTokens)
    if (score <= 0) continue

    const titleTokens = new Set(tokenize(`${page.title} ${page.tags.join(' ')}`))
    if (queryTokens.some((token) => titleTokens.has(token))) {
      hits.push({
        slug: page.slug,
        title: page.title,
        score,
        snippet: page.title,
        line: 1,
        matchedIn: '标题',
      })
      continue
    }

    let count = 0
    const lines = page.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const lineTokens = new Set(tokenize(line))
      if (!queryTokens.some((token) => lineTokens.has(token))) continue
      hits.push({
        slug: page.slug,
        title: page.title,
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
