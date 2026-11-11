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

/**
 * 远程上游的认证方式。
 *
 * - `none`：不带认证
 * - `static`：用 headers 里配的固定令牌（如 api key、personal access token）
 * - `oauth`：走 OAuth 2.1 授权码流程（远程 mcp server 普遍要求）
 */
export type McpAuthKind = 'none' | 'static' | 'oauth'

/** OAuth 授权状态 */
export type McpOAuthState = 'idle' | 'pending' | 'authorized' | 'error'

/** OAuth 授权的运行时信息 */
export type McpOAuthStatus = {
  state: McpOAuthState
  /** 待用户打开的授权地址（pending 时有值） */
  authorizeUrl?: string
  /** 请求的 scope */
  scope?: string
  error?: string
  /** 最近一次成功授权时间 */
  authorizedAt?: string
  /**
   * 令牌来源。
   *
   * - `manual`：用户手动配置的令牌
   * - `oauth`：浏览器授权换来的令牌
   * - `none`：还没有令牌
   */
  tokenSource?: 'manual' | 'oauth' | 'none'
}

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
  /** 远程上游的认证方式，默认 none */
  auth?: McpAuthKind
  /**
   * 手动配置的令牌（`auth: 'oauth'` 时用）。
   *
   * 两种写法都支持：
   * - 字面量：用户自己贴的 PAT / 长效 token
   * - `${ENV:NAME}` 占位：令牌本体在环境变量里
   *
   * 留空 / 不填 = 走浏览器 OAuth 授权流程。
   */
  token?: string
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
  /** OAuth 授权状态（仅 auth 为 oauth 的 http 上游有值） */
  oauth?: McpOAuthStatus
  /**
   * 令牌来源。
   *
   * - `manual`：用户手动配置的固定令牌
   * - `env`：手动配置的令牌写的是 `${ENV:NAME}`，真实值在环境变量里
   * - `oauth`：浏览器授权流程换来的令牌
   * - `none`：没有令牌
   */
  tokenSource?: 'manual' | 'env' | 'oauth' | 'none'
  /**
   * 工具清单是不是来自缓存（当前没连上）。
   *
   * 上游是惰性连接的：页面刚打开时没连，工具清单读的是上次落盘的缓存。
   * 界面据此显示「上次连接成功」而不是「未连接」。
   */
  toolsFromCache?: boolean
  /** 缓存时间（epoch 毫秒） */
  toolsCachedAt?: number
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

// ─────────────────────────────────────────────────────────
// 官方 MCP Registry（目录）
// ─────────────────────────────────────────────────────────

/** registry 里声明的包安装方式 */
export type McpRegistryPackage = {
  registryType?: string
  identifier?: string
  version?: string
  /** 启动器提示，如 npx / uvx / docker */
  runtimeHint?: string
  transport?: { type?: string }
  /** 追加到启动命令后的参数 */
  runtimeArguments?: Array<{ type?: string; value?: string }>
  /** 该 server 需要的环境变量 */
  environmentVariables?: Array<{
    name?: string
    description?: string
    isRequired?: boolean
    format?: string
  }>
}

/** registry 里声明的远程端点 */
export type McpRegistryRemote = {
  type?: string
  url?: string
  headers?: Array<{ name?: string; value?: string; description?: string; isRequired?: boolean }>
}

/** 目录里的一条 server */
export type McpRegistryEntry = {
  /** 全局唯一名，如 io.github.owner/repo */
  name: string
  title?: string
  description?: string
  version?: string
  homepage?: string
  repository?: { url?: string; source?: string }
  /** 可安装的包（stdio 形态） */
  packages?: McpRegistryPackage[]
  /** 远程端点（http 形态） */
  remotes?: McpRegistryRemote[]
  /** 是否官方收录 */
  official?: boolean
  /** 能否直接落地为上游定义（本地可启动或存在远程端点） */
  installable?: boolean
  /** 目录条目自动翻译出的上游定义，installable 为 true 时存在 */
  def?: McpServerDef
}

/** 目录搜索结果 */
export type McpRegistrySearchResult = {
  entries: McpRegistryEntry[]
  /** 下一页游标，为空表示没有更多 */
  nextCursor?: string
  /** 搜索所用的目录名 */
  source: string
}

export const MCP_COMMANDS = {
  ensureSidecar: 'mcp_ensure_sidecar',
  searchRegistry: 'mcp_search_registry',
  authorizeServer: 'mcp_authorize_server',
  openUrl: 'mcp_open_url',
  listServers: 'mcp_list_servers',
  saveServers: 'mcp_save_servers',
  removeServer: 'mcp_remove_server',
  testServer: 'mcp_test_server',
  probeServerDef: 'mcp_probe_server_def',
  connectServers: 'mcp_connect_servers',
  getExposure: 'mcp_get_exposure',
  setExposure: 'mcp_set_exposure',
  listProfiles: 'mcp_list_profiles',
  saveProfiles: 'mcp_save_profiles',
  getStatus: 'mcp_get_status',
  refreshToken: 'mcp_refresh_token',
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
