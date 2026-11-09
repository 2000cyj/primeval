/**
 * AgentCompose MCP proxy —— 前后端共享的类型契约与纯函数。
 *
 * ⚠️ 本文件是唯一的契约来源（single source of truth）：
 *    - sidecar（Node）实现它
 *    - Vue 前端通过 `import type` / 纯函数消费它
 *    修改此文件需同步通知两侧。
 */

// ─────────────────────────────────────────────────────────
// 上游 MCP server 定义（用户管理的那一批）
// ─────────────────────────────────────────────────────────

export type McpTransportKind = 'stdio' | 'http'

export type McpServerDef = {
  /** 全局唯一，作为工具命名空间前缀 */
  id: string
  /** 展示名 */
  name: string
  transport: McpTransportKind
  // ── stdio ──
  command?: string
  args?: string[]
  /** 值可写 `${ENV:NAME}` 占位，真实值从环境变量 / keychain 解析 */
  env?: Record<string, string>
  // ── http ──
  url?: string
  /** 值可写 `${ENV:NAME}` 占位 */
  headers?: Record<string, string>
  /** 是否参与对外暴露 */
  enabled: boolean
}

// ─────────────────────────────────────────────────────────
// 对外暴露配置
// ─────────────────────────────────────────────────────────

/** 工具白名单条目格式：`serverId::原始工具名` */
export type McpToolKey = string

export type McpExposure = {
  /** 对外可见的 server id */
  serverIds: string[]
  /** 允许暴露的工具（原始名，非命名空间名） */
  toolKeys: McpToolKey[]
  /** 工具总数硬上限，超出按 serverIds 顺序裁剪 */
  maxTools: number
}

// ─────────────────────────────────────────────────────────
// Profile（命名组合）
// ─────────────────────────────────────────────────────────

export type McpProfile = {
  id: string
  name: string
  /** 成员 server id */
  serverIds: string[]
}

// ─────────────────────────────────────────────────────────
// 运行时状态
// ─────────────────────────────────────────────────────────

export type McpUpstreamState = 'disabled' | 'disconnected' | 'connecting' | 'ready' | 'error'

export type McpToolInfo = {
  serverId: string
  /** 原始工具名（不含命名空间前缀） */
  name: string
  description?: string
  /** JSON Schema，原样透传 */
  inputSchema: unknown
}

export type McpUpstreamStatus = {
  serverId: string
  state: McpUpstreamState
  tools: McpToolInfo[]
  error?: string
  lastConnectedAt?: string
  /** 已重连次数，0 表示未重连过 */
  reconnectAttempt: number
}

export type McpCallLog = {
  id: string
  ts: string
  sessionId?: string
  serverId: string
  /** 原始工具名 */
  toolName: string
  durationMs: number
  ok: boolean
  error?: string
}

/** sidecar 运行时总状态 */
export type McpRuntimeStatus = {
  /** 基础地址，形如 `http://127.0.0.1:7801` */
  endpoint: string
  /** Bearer token */
  token: string
  /** 实际监听端口 */
  port: number
  /** 当前在线 MCP session 数 */
  sessions: number
  upstreams: McpUpstreamStatus[]
  exposure: McpExposure
  profiles: McpProfile[]
}

// ─────────────────────────────────────────────────────────
// 粒度：URL 路径表达 agent 连哪一组
// ─────────────────────────────────────────────────────────

export type McpSelection =
  /** 全部启用的 server */
  | { kind: 'all' }
  /** 单个 server —— 工具名不带前缀 */
  | { kind: 'server'; serverId: string }
  /** 临时组合 —— 工具名带前缀 */
  | { kind: 'servers'; serverIds: string[] }
  /** 命名 profile —— 工具名带前缀 */
  | { kind: 'profile'; profileId: string }

export const MCP_ENDPOINT_BASE = '/mcp'

/**
 * 由选择生成 MCP 接入路径（不含 origin 与 token）。
 * - `/mcp`                      全部
 * - `/mcp/s/github`             单个
 * - `/mcp/s/github+postgres`    组合
 * - `/mcp/p/backend`             profile
 */
export function buildMcpPath(sel: McpSelection): string {
  switch (sel.kind) {
    case 'all':
      return MCP_ENDPOINT_BASE
    case 'server':
      return `${MCP_ENDPOINT_BASE}/s/${encodeURIComponent(sel.serverId)}`
    case 'servers': {
      const ids = sel.serverIds.filter(Boolean)
      if (ids.length === 0) return MCP_ENDPOINT_BASE
      const only = ids[0]
      if (ids.length === 1 && only) {
        return `${MCP_ENDPOINT_BASE}/s/${encodeURIComponent(only)}`
      }
      return `${MCP_ENDPOINT_BASE}/s/${ids.map((id) => encodeURIComponent(id)).join('+')}`
    }
    case 'profile':
      return `${MCP_ENDPOINT_BASE}/p/${encodeURIComponent(sel.profileId)}`
  }
}

/**
 * 完整接入 URL（含 token query，兼容只支持 URL 传参的客户端）。
 */
export function buildMcpUrl(origin: string, sel: McpSelection, token: string): string {
  const base = origin.replace(/\/+$/, '')
  const url = `${base}${buildMcpPath(sel)}`
  return token ? `${url}?token=${encodeURIComponent(token)}` : url
}

// ─────────────────────────────────────────────────────────
// 工具命名空间
// ─────────────────────────────────────────────────────────

/** 命名空间分隔符 */
export const MCP_NS_SEPARATOR = '__'

/** 对外工具名 = `{serverId}__{原始工具名}` */
export function exposedToolName(serverId: string, toolName: string): string {
  return `${serverId}${MCP_NS_SEPARATOR}${toolName}`
}

/** 白名单条目 key = `serverId::原始工具名` */
export function toolKey(serverId: string, toolName: string): string {
  return `${serverId}::${toolName}`
}

/** 从白名单 key 还原 `{serverId, toolName}` */
export function parseToolKey(key: string): { serverId: string; toolName: string } | null {
  const idx = key.indexOf('::')
  if (idx <= 0) return null
  return {
    serverId: key.slice(0, idx),
    toolName: key.slice(idx + 2),
  }
}

// ─────────────────────────────────────────────────────────
// Tauri command 名（前端 ↔ sidecar 桥接层）
// ─────────────────────────────────────────────────────────

export const MCP_COMMANDS = {
  listServers: 'mcp_list_servers',
  saveServers: 'mcp_save_servers',
  removeServer: 'mcp_remove_server',
  testServer: 'mcp_test_server',
  getExposure: 'mcp_get_exposure',
  setExposure: 'mcp_set_exposure',
  listProfiles: 'mcp_list_profiles',
  saveProfiles: 'mcp_save_profiles',
  getStatus: 'mcp_get_status',
} as const

export type McpCommandName = (typeof MCP_COMMANDS)[keyof typeof MCP_COMMANDS]

// ─────────────────────────────────────────────────────────
// 配置存档（落盘格式）
// ─────────────────────────────────────────────────────────

export type McpConfigFile = {
  servers: McpServerDef[]
  exposure: McpExposure
  profiles: McpProfile[]
}

/** 默认暴露配置 */
export function defaultExposure(): McpExposure {
  return { serverIds: [], toolKeys: [], maxTools: 150 }
}
