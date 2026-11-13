/**
 * Pi 扩展管理的 Tauri command 封装。
 *
 * 三块：
 * - 已安装：扫各个来源目录（全局 / 项目 / settings 声明 / package 带的）
 * - 市场：搜 npm registry 的 `keywords:pi-package`（pi 官方市场的数据源）
 * - 自定义：自己写扩展脚本
 *
 * 装扩展走 pi 自己的命令（`pi install <source>`）—— 不自己实现一套，
 * 保证和 pi 的行为一致（settings.json 写法、缓存目录、ref 对齐）。
 */
import { invoke } from '@tauri-apps/api/core'

/**
 * 扩展的来源种类。
 *
 * - `builtin` —— pi 自带的（运行时自动加载，不能绑到智能体上）
 * - `npm` —— 我们从 npm 装到工具箱里的
 * - `custom` —— 用户自己写放到工具箱里的
 */
export type ExtensionSourceKind = 'builtin' | 'npm' | 'custom'

/** 一个已安装的扩展 */
export interface ExtensionInfo {
  /** 扩展名 */
  name: string
  /** 扩展文件或目录的绝对路径 */
  path: string
  /** 来源种类 */
  source: ExtensionSourceKind
  /** 来自哪个包（来源是 package 时有值） */
  package: string | null
  /** 是否启用 */
  enabled: boolean
  /** 文件大小（字节） */
  size: number
  /** 最后修改时间（epoch 毫秒） */
  updatedAtMs: number
}

/** 市场里的一个包 */
export interface MarketplacePackage {
  /** npm 包名（装的时候用 `npm:<name>`） */
  name: string
  /** 描述 */
  description: string
  /** 最新版本 */
  version: string
  /** 作者 */
  author: string | null
  /** 仓库地址 */
  repository: string | null
  /** 主页 */
  homepage: string | null
  /** 周下载量 */
  weeklyDownloads: number
  /** 发布时间 */
  publishedAt: string | null
  /** 关键字 */
  keywords: string[]
}

/** 市场搜索结果 */
export interface MarketplaceSearchResult {
  /** 命中的总数（整个市场，不是这一页） */
  total: number
  /** 这一页的结果 */
  packages: MarketplacePackage[]
  /** 这一页从第几条开始（0 = 第一页） */
  offset: number
  /** 这一页取了多少条 */
  limit: number
}

/** 一个动作的执行结果 */
export interface CommandOutput {
  ok: boolean
  message: string
}

export const EXTENSION_COMMANDS = {
  list: 'extensions_list',
  read: 'extensions_read',
  setEnabled: 'extensions_set_enabled',
  remove: 'extensions_remove',
  save: 'extensions_save',
  template: 'extensions_template',
  marketSearch: 'extensions_market_search',
  installNpm: 'extensions_install_npm',
  removeLibrary: 'extensions_remove_library',
} as const

/** 统一的错误包装：保留原始原因，便于界面直接展示 */
function fail(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${action}失败：${detail}`, { cause: error })
}

/** 列出已安装的扩展 */
export async function listExtensions(): Promise<ExtensionInfo[]> {
  try {
    return await invoke<ExtensionInfo[]>(EXTENSION_COMMANDS.list)
  } catch (error) {
    throw fail('读取扩展列表', error)
  }
}

/** 读一个扩展的源码 */
export async function readExtension(path: string): Promise<string> {
  try {
    return await invoke<string>(EXTENSION_COMMANDS.read, { path })
  } catch (error) {
    throw fail('读取扩展源码', error)
  }
}

/** 启用 / 停用一个扩展 */
export async function setExtensionEnabled(path: string, enabled: boolean): Promise<CommandOutput> {
  try {
    return await invoke<CommandOutput>(EXTENSION_COMMANDS.setEnabled, { path, enabled })
  } catch (error) {
    throw fail('更新扩展状态', error)
  }
}

/** 删掉一个扩展 */
export async function removeExtension(path: string): Promise<CommandOutput> {
  try {
    return await invoke<CommandOutput>(EXTENSION_COMMANDS.remove, { path })
  } catch (error) {
    throw fail('删除扩展', error)
  }
}

/** 写一个自定义扩展 */
export async function saveExtension(name: string, code: string): Promise<CommandOutput> {
  try {
    return await invoke<CommandOutput>(EXTENSION_COMMANDS.save, { name, code })
  } catch (error) {
    throw fail('保存扩展', error)
  }
}

/** 新扩展的模板代码 */
export async function extensionTemplate(): Promise<string> {
  try {
    return await invoke<string>(EXTENSION_COMMANDS.template)
  } catch (error) {
    throw fail('读取模板', error)
  }
}

/** 搜扩展市场 */
export async function searchMarketplace(
  query: string,
  limit?: number,
  offset?: number,
): Promise<MarketplaceSearchResult> {
  try {
    return await invoke<MarketplaceSearchResult>(EXTENSION_COMMANDS.marketSearch, {
      query,
      limit: limit ?? null,
      offset: offset ?? null,
    })
  } catch (error) {
    throw fail('搜索扩展市场', error)
  }
}

/**
 * 从 npm 装一个扩展到工具箱。
 *
 * 不走 `pi install` —— 那会把声明写进 pi 的全局 settings.json，
 * 扩展也落在 pi 的全局目录。我们要自己管。
 */
export async function installExtensionFromNpm(name: string): Promise<CommandOutput> {
  try {
    return await invoke<CommandOutput>(EXTENSION_COMMANDS.installNpm, { name })
  } catch (error) {
    throw fail('安装扩展', error)
  }
}

/** 删掉工具箱里的一个扩展（npm 或自定义） */
export async function removeExtensionFromLibrary(
  source: 'npm' | 'custom',
  name: string,
): Promise<CommandOutput> {
  try {
    return await invoke<CommandOutput>(EXTENSION_COMMANDS.removeLibrary, { source, name })
  } catch (error) {
    throw fail('删除扩展', error)
  }
}

/**
 * npm 的 repository 字段长得五花八门：
 * `git+https://github.com/o/r.git`、`git://github.com/o/r.git`、
 * `git@github.com:o/r.git`、`https://github.com/o/r` 都有。
 *
 * 直接拿来当链接会变成「下载 .git 文件」而不是打开仓库页 ——
 * 所以把协议前缀和 .git 后缀都归一化掉。
 */
export function repoLink(repository: string): string {
  return repository
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '')
}
