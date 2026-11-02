export type CapabilityKind = 'skill' | 'mcp'

export type BadgeTone = 'default' | 'beta'

export type IconColor = 'blue' | 'violet' | 'green' | 'orange' | 'cyan' | 'amber' | 'dark' | 'pink'

export interface CapabilityBadge {
  text: string
  tone: BadgeTone
}

/**
 * 能力状态文案（实测原型口径：Skill 与 MCP 一致）
 *
 * 启用态 = 运行中，停用态 = 已停用。
 */
export type CapabilityStatus = '运行中' | '已停用'

/** 能力类型在「能力详情」抽屉中的展示文案（对齐实测原型） */
export const CAPABILITY_KIND_LABELS: Record<CapabilityKind, string> = {
  skill: 'Agent Skill',
  mcp: 'MCP Server',
}

/** MCP 连接方式枚举：mock 数据与「编辑 MCP 服务」弹窗的选项同源 */
export const MCP_TRANSPORTS = ['HTTP 连接', 'SSE 远程', '本地 stdio'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/** 连接方式在工作区中的展示文案 */
export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  'HTTP 连接': '远程 · HTTP',
  'SSE 远程': '远程 · SSE',
  '本地 stdio': '本地 · stdio',
}

/** MCP 服务的分类选项（卡片标签、弹窗下拉与筛选 chips 共用同一份取值） */
export const MCP_CATEGORIES = [
  '本地服务',
  '数据库',
  '研发协作',
  '设计工具',
  '团队协作',
  '开发工具',
] as const

/** Skill 的分类选项 */
export const SKILL_CATEGORIES = ['知识处理', '开发工具', '数据分析', '多模态', '效率工具'] as const

/**
 * 能力中心的行内分类 chips（实测原型口径，只是一组快捷筛选）
 *
 * - MCP 服务页签：全部 / 本地服务 / 数据库 / 研发协作
 * - Skills 页签：全部 / 知识处理 / 开发工具 / 数据分析
 *
 * 注意：行内 chips 与「筛选」面板里的「分类」分组是两套，后者是「全部 + 该页签全部分类」。
 */
export const MCP_FILTER_CHIPS = ['全部', '本地服务', '数据库', '研发协作'] as const
export const SKILL_FILTER_CHIPS = ['全部', '知识处理', '开发工具', '数据分析'] as const

export interface Capability {
  id: string
  kind: CapabilityKind
  name: string
  description: string
  category: string
  badge?: CapabilityBadge
  icon: string
  iconColor: IconColor
  enabled: boolean
  /** 能力详情抽屉「当前状态」的文案：运行中 / 已停用 */
  statusLabel?: CapabilityStatus
  updatedAt?: string
  /** 连接方式（MCP 专有）：取自 MCP_TRANSPORTS 枚举 */
  transport?: McpTransport
  /** 该能力过去 12 天的调用分布（12 个柱状高度百分比） */
  usage: number[]
  /** 该能力自身的调用量（单能力口径，不是工作区总量） */
  calls: number
}

export interface NotificationItem {
  id: string
  title: string
  body: string
  time: string
  unread: boolean
}

export type CliStatus = 'ready' | 'login'

export interface CliTool {
  id: string
  name: string
  desc: string
  command: string
  path: string
  version: string
  status: CliStatus
  seen: string
  icon: string
  iconColor: IconColor
}
