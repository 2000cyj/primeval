/**
 * 内置 Wiki 的 Tauri 命令封装。
 *
 * Wiki 页面就是本机 `~/.agent-compose/wiki/` 下的 Markdown 文件：
 * 人可以在界面上编辑，agent 通过 MCP 端点读同一份文件 —— 所以这里只做搬运，
 * 不在前端缓存正文，也不自己拼路径。
 */
import { invoke } from '@tauri-apps/api/core'

import type { SkillInfo } from './skills'

/** 一个页面的元信息（不含正文） */
export interface WikiPageMeta {
  /** 唯一标识，也是目录名 */
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
export interface WikiPage extends WikiPageMeta {
  /** 正文（Markdown 源码） */
  content: string
}

/** 搜索命中 */
export interface WikiSearchHit {
  /** 页面 slug */
  slug: string
  /** 标题 */
  title: string
  /** 命中行附近的内容片段 */
  snippet: string
  /** 命中的行号（正文里的行号，从 1 开始） */
  line: number
}

/** 列出所有页面（只有元信息，正文要单独读） */
export const listWikiPages = (): Promise<WikiPageMeta[]> => invoke<WikiPageMeta[]>('wiki_list')

/** 读一个页面（含正文） */
export const readWikiPage = (slug: string): Promise<WikiPage> =>
  invoke<WikiPage>('wiki_read', { slug })

/**
 * 保存一个页面。
 *
 * slug 是页面身份，改标题不会换 slug —— 目录名跟着标题走会让 agent 手里的
 * 链接全部失效，所以这里只传 slug，不传新目录名。
 */
export const saveWikiPage = (
  slug: string,
  title: string,
  content: string,
  tags: string[],
  parent: string | null,
): Promise<WikiPage> => invoke<WikiPage>('wiki_save', { slug, title, content, tags, parent })

/** 新建页面（父页面可空 = 顶层） */
export const createWikiPage = (title: string, parent: string | null): Promise<WikiPage> =>
  invoke<WikiPage>('wiki_create', { title, parent })

/** 删掉一个页面 */
export const deleteWikiPage = (slug: string): Promise<void> => invoke<void>('wiki_delete', { slug })

/** 搜索标题与正文 */
export const searchWiki = (query: string): Promise<WikiSearchHit[]> =>
  invoke<WikiSearchHit[]>('wiki_search', { query })

/**
 * 把页面发布成 skill。
 *
 * skill 本质就是「agent 可读的 Markdown」—— wiki 里写的部署手册、排查步骤，
 * 发布成 skill 后就能直接绑到智能体上，不用在两个地方写一遍。
 *
 * skill 名不给就用页面标题。
 */
export const publishWikiAsSkill = (slug: string, name?: string): Promise<SkillInfo> =>
  invoke<SkillInfo>('wiki_publish_as_skill', { slug, name })
