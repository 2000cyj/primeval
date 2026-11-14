/**
 * 数据管理：把本机的智能体、Skills、MCP server、Pi 扩展导出成一个 zip，
 * 或者把别的机器导出的 zip 导回来。
 *
 * 打包、解析、冲突比对全在 Rust 侧做（apps/agentspace-core/src/backup.rs），
 * 前端只负责传参和把结果摆到界面上 ——
 * 「这条数据算远程还是本地」「同名算不算冲突」这类判定两边各写一遍迟早对不上，
 * 所以这里老老实实只做搬运。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** 一条数据的来源方式：远程（只记下载链接）/ 本地（打包原文件）。 */
export type BackupSourceKind = 'remote' | 'local'

/**
 * 扩展的来源渠道。
 *
 * 后端给的是「npm」/「自定义」这样的字面量（不是一整套英文枚举），
 * 所以留个兜底 —— 后端换个说法前端不至于直接红一片。
 */
export type BackupExtensionSource = 'npm' | 'custom' | 'builtin' | (string & {})

/** 冲突项的类别 —— 也用来拼「覆盖」的 key（`skill:vue`）。 */
export type BackupConflictType = 'agent' | 'skill' | 'mcpServer' | 'extension'

/** 可导出的智能体。 */
export interface BackupAgent {
  /** 智能体 id */
  id: string
  /** 智能体名字 */
  name: string
  /** 智能体描述 */
  description: string
  /** 引用的 skill 相对路径，如 `skills/vue` */
  skills: string[]
  /** 引用的 MCP server id 列表 */
  mcpServers: string[]
  /** 引用的扩展相对路径，如 `extensions/npm/context-mode` */
  extensions: string[]
}

/** 可导出的 skill。 */
export interface BackupSkill {
  /** skill 目录名（也是唯一键） */
  name: string
  /** skill 描述 */
  description: string
  /** 远程来源还是本地手写 */
  kind: BackupSourceKind
  /** 远程来源的可读描述，如 `github.com/owner/repo@0.6.13`；本地为空 */
  sourceLabel: string
}

/** 可导出的 MCP server。 */
export interface BackupMcpServer {
  /** MCP server id */
  id: string
  /** 展示名 */
  name: string
  /** 远程来源还是本地手写 */
  kind: BackupSourceKind
  /** 远程来源描述，如 registry 名；本地为空 */
  sourceLabel: string
}

/** 可导出的 Pi 扩展。 */
export interface BackupExtension {
  /** 扩展名（唯一键） */
  name: string
  /** 扩展来自哪里 */
  source: BackupExtensionSource
  /** 远程来源还是本地文件 */
  kind: BackupSourceKind
  /** 来源的可读描述 */
  sourceLabel: string
}

/** 本机所有可导出的数据。 */
export interface BackupInventory {
  agents: BackupAgent[]
  skills: BackupSkill[]
  mcpServers: BackupMcpServer[]
  extensions: BackupExtension[]
}

/** 导出时勾了什么。 */
export interface BackupExportRequest {
  agentIds: string[]
  skillNames: string[]
  mcpServerIds: string[]
  extensionNames: string[]
}

/** 各类型各多少条 —— 导出数量、导入结果、清单摘要共用一个形状。 */
export interface BackupCounts {
  agents: number
  skills: number
  mcpServers: number
  extensions: number
}

/** 导出结果。 */
export interface BackupExportResult {
  /** 写出来的 zip 路径 */
  zipPath: string
  /** 文件名 */
  fileName: string
  /** 各类型导出了多少条 */
  counts: BackupCounts
}

/** 一条冲突。 */
export interface BackupConflict {
  /**
   * 冲突项的类别。
   *
   * 后端（agentspace-core/src/backup.rs）序列化出来的字段名是 `kind`，
   * 设计文档里写的是 `type` —— 两个名字都收下，避免后端改了口径前端就瞎。
   */
  kind?: BackupConflictType
  /** 类别（文档口径），与 `kind` 二选一 */
  type?: BackupConflictType
  /** 冲突项的标识（skill 名 / MCP id / 扩展名 / 智能体 id） */
  key: string
  /** 展示名 */
  label: string
  /** 本地已有的那个的说明，如「已存在，来源 github.com/x/y」 */
  localHint: string
  /** 导入包里的那个的说明 */
  incomingHint: string
}

/** 冲突检查报告。 */
export interface BackupConflictReport {
  /** manifest 里一共有什么 */
  summary: BackupCounts
  /** 逐条的冲突信息 —— 界面要按这个列勾选框 */
  conflicts: BackupConflict[]
  /** 不冲突的条目数（会直接导入） */
  freshCount: number
  /** 解析出来的问题（如 manifest 版本不认识） */
  warnings: string[]
}

/** 导入进度（后端推的）。 */
export interface BackupImportProgress {
  /** 任务 id */
  taskId: string
  /** 当前阶段（准备中 / 导入 Skills / …） */
  phase: string
  /** 已完成条数 */
  current: number
  /** 总条数 */
  total: number
  /** 这一步的说明 */
  message: string
}

/** 导入结束（后端推的）。 */
export interface BackupImportDone {
  /** 任务 id */
  taskId: string
  /** 成功时的结果 */
  result?: BackupImportResult
  /** 失败时的原因 */
  error?: string
}

/** 导入任务的状态（查任务用）。 */
export interface BackupImportTask {
  taskId: string
  phase: string
  current: number
  total: number
  message: string
  finished: boolean
}

/** 导入请求。 */
export interface BackupImportRequest {
  /** 要导入的 zip 路径 */
  zipPath: string
  /** 冲突项里用户勾了「覆盖」的 key —— 格式 `类别:标识`，如 `skill:vue` */
  overwriteKeys: string[]
}

/** 导入结果。 */
export interface BackupImportResult {
  /** 成功导入的条数 */
  imported: BackupCounts
  /** 因为冲突被跳过的条数 */
  skipped: BackupCounts
  /** 失败的条目，如「skill:vue —— 仓库拉取失败」 */
  failures: string[]
  /** 提醒，如智能体引用了但没导入到的 skill */
  warnings: string[]
}

/**
 * 取一条冲突的类别。
 *
 * 两个字段名（kind / type）都能认；都拿不到时返回 null ——
 * 这种冲突没法参与「覆盖」，界面就不给它画勾选框。
 */
export const backupConflictType = (conflict: BackupConflict): BackupConflictType | null =>
  conflict.kind ?? conflict.type ?? null

/**
 * 拼一条冲突的「覆盖」key。
 *
 * 后端认的格式是 `类别:标识`（`skill:vue` / `mcpServer:idea` / `extension:xxx` / `agent:xxx`），
 * 拼不出来时返回 null —— 调用方不该把半截 key 递过去。
 */
export const backupOverwriteKey = (conflict: BackupConflict): string | null => {
  const type = backupConflictType(conflict)
  return type ? `${type}:${conflict.key}` : null
}

/** 列出本机所有可导出的数据（打开导出弹窗时调用）。 */
export const listBackupInventory = (): Promise<BackupInventory> =>
  invoke<BackupInventory>('backup_inventory')

/**
 * 导出成 zip。
 *
 * 保存位置由后端弹系统对话框让用户选，前端不参与 ——
 * 让用户在两个地方选同一个路径迟早会选歪。
 */
export const exportBackup = (request: BackupExportRequest): Promise<BackupExportResult> =>
  invoke<BackupExportResult>('backup_export', { request })

/** 解析一个 zip，比对本地，给出冲突清单（导入第一步）。 */
export const inspectBackup = (zipPath: string): Promise<BackupConflictReport> =>
  invoke<BackupConflictReport>('backup_inspect', { zipPath })

/**
 * 启动导入（异步）。
 *
 * 导入可能要拉远程仓库、跑 npm install —— 几十秒起步。
 * 所以后端把它丢到后台跑，立刻返回 taskId；进度与结果走事件。
 *
 * @returns 任务 id
 */
export const importBackup = (request: BackupImportRequest): Promise<string> =>
  invoke<string>('backup_import', { request })

/** 查导入任务的状态（事件丢了的兜底）。 */
export const backupImportStatus = (taskId: string): Promise<BackupImportTask | null> =>
  invoke<BackupImportTask | null>('backup_import_status', { taskId })

/** 订阅导入进度。 */
export const onBackupImportProgress = (
  handler: (progress: BackupImportProgress) => void,
): Promise<UnlistenFn> =>
  listen<BackupImportProgress>('backup-import-progress', (event) => {
    handler(event.payload)
  })

/** 订阅导入结束。 */
export const onBackupImportDone = (
  handler: (done: BackupImportDone) => void,
): Promise<UnlistenFn> =>
  listen<BackupImportDone>('backup-import-done', (event) => {
    handler(event.payload)
  })
