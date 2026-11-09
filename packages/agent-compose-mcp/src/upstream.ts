/**
 * 上游连接池：sidecar 对每个用户配置的 MCP server 维护一条长连接。
 *
 * - 按 serverId 复用连接：多个 agent 用同一个上游时只握手一次。
 * - 惰性连接：真正需要该 server 时才建连。
 * - 断线重连：指数退避 1s → 2s → 4s → 8s，之后封顶 30s。
 * - 工具清单定时刷新（默认 60s），状态变化通过事件总线推给 UI。
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { CallToolResult, Tool, Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { resolveEnvPlaceholders, resolveEnvRecord } from './config.ts'
import type { EventBus } from './events.ts'
import type { OAuthManager } from './oauth.ts'
import type { McpServerDef, McpToolInfo, McpUpstreamState, McpUpstreamStatus } from './types.ts'

/** 工具清单刷新间隔（毫秒） */
export const DEFAULT_TOOL_REFRESH_INTERVAL_MS = 60_000

/** 重连退避阶梯（毫秒），超出后封顶到 RECONNECT_MAX_BACKOFF_MS */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000]

/** 重连退避上限（毫秒） */
export const RECONNECT_MAX_BACKOFF_MS = 30_000

/** 第 attempt 次重连要等待的时长 */
export function reconnectDelay(attempt: number): number {
  if (attempt <= 0) return RECONNECT_BACKOFF_MS[0] ?? RECONNECT_MAX_BACKOFF_MS
  const step = RECONNECT_BACKOFF_MS[attempt]
  return step ?? RECONNECT_MAX_BACKOFF_MS
}

export type UpstreamPoolOptions = {
  /** oauth 管理器：远程上游用 oauth 授权时需要 */
  oauth?: OAuthManager
  /** 工具清单刷新间隔，默认 60s */
  toolRefreshIntervalMs?: number
  /** 握手用的 client 名 */
  clientName?: string
  /** 握手用的 client 版本 */
  clientVersion?: string
}

type UpstreamEntry = {
  def: McpServerDef
  client: Client | undefined
  transport: Transport | undefined
  state: McpUpstreamState
  tools: McpToolInfo[]
  error: string | undefined
  lastConnectedAt: string | undefined
  /** 已发起的重连次数，0 表示还没重连过 */
  reconnectAttempt: number
  connecting: Promise<Client | undefined> | undefined
  refreshTimer: NodeJS.Timeout | undefined
  reconnectTimer: NodeJS.Timeout | undefined
  /** 主动关闭标记：主动关闭不触发重连 */
  closed: boolean
  /** 子进程 stderr 的最近若干行，用于连接失败时给出可读原因 */
  stderrLines: string[]
}

/**
 * 翻译远程上游的常见错误。
 *
 * 远程 mcp server 未授权时返回 401，原始信息只有一个 Unauthorized，
 * 用户看不出该做什么 —— 需要点「授权」走 oauth 流程。
 */
export function explainUpstreamError(detail: string, def: McpServerDef): string {
  if (def.transport !== 'http') return detail
  if (/Unauthorized|401/i.test(detail)) {
    if (def.auth === 'oauth') {
      return '该远程 server 需要授权：请点击「授权」按钮，在浏览器里完成授权后重试。'
    }
    return '该远程 server 拒绝了当前请求（401）：请在「编辑」里补上有效的认证令牌（headers）。'
  }
  if (/Dynamic Client Registration rejected|403/i.test(detail)) {
    return (
      '该远程 server 拒绝了本应用的客户端注册（403）。' +
      '部分服务只允许白名单内的客户端进行 OAuth 授权，' +
      '这种服务请改用固定令牌认证，或改用该服务的本地版本。'
    )
  }
  return detail
}

/**
 * 检查命令是否存在于 PATH。
 *
 * @returns 命令缺失时的说明；存在则返回 null
 */
async function findMissingCommand(command: string): Promise<string | null> {
  const isWindows = process.platform === 'win32'
  const probe = isWindows ? 'where' : 'which'
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    await run(probe, [command], { windowsHide: true })
    return null
  } catch {
    return isWindows ? '（windows 下可用 where <命令> 确认）' : '（可用 which <命令> 确认）'
  }
}

/**
 * 从子进程 stderr 里挑出真正有用的行。
 *
 * npx 会打一堆 npm notice（run xxx、下载进度），这些是噪音；
 * 真正的原因（如用法说明、缺少参数）通常在后几行。
 */
function pickStderr(lines: string[]): string {
  const noisy = /^(npm notice|npm warn|added \d+ packages|sh: |$)/
  const meaningful = lines.filter((line) => !noisy.test(line))
  const picked = meaningful.length > 0 ? meaningful : lines
  return picked.slice(-6).join('\n').trim()
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function toToolInfo(serverId: string, tool: Tool): McpToolInfo {
  const info: McpToolInfo = {
    serverId,
    name: tool.name,
    inputSchema: tool.inputSchema,
  }
  if (tool.description !== undefined) info.description = tool.description
  return info
}

/** 连接参数是否发生变化（变了就要断开重连） */
function sameConnection(a: McpServerDef, b: McpServerDef): boolean {
  return (
    a.transport === b.transport &&
    a.command === b.command &&
    a.url === b.url &&
    JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? []) &&
    JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {}) &&
    JSON.stringify(a.headers ?? {}) === JSON.stringify(b.headers ?? {})
  )
}

export class UpstreamPool {
  private readonly entries = new Map<string, UpstreamEntry>()
  private readonly oauth: OAuthManager | undefined
  private readonly bus: EventBus
  private readonly toolRefreshIntervalMs: number
  private readonly clientName: string
  private readonly clientVersion: string

  constructor(servers: McpServerDef[], bus: EventBus, options?: UpstreamPoolOptions) {
    this.bus = bus
    this.oauth = options?.oauth
    this.toolRefreshIntervalMs = options?.toolRefreshIntervalMs ?? DEFAULT_TOOL_REFRESH_INTERVAL_MS
    this.clientName = options?.clientName ?? 'agent-compose-mcp'
    this.clientVersion = options?.clientVersion ?? '0.1.0'
    this.setServers(servers)
  }

  /**
   * 用新的 server 定义列表重整连接池：新增的登记，连接参数变了的重连，删掉的关掉。
   */
  setServers(servers: McpServerDef[]): void {
    const next = new Map(servers.map((def) => [def.id, def]))

    for (const [id, entry] of [...this.entries]) {
      const def = next.get(id)
      if (!def) {
        this.entries.delete(id)
        void this.closeEntry(entry, 'disconnected', false)
        continue
      }
      if (!sameConnection(def, entry.def)) {
        this.entries.delete(id)
        void this.closeEntry(entry, 'disconnected', false)
        continue
      }
      entry.def = def
    }

    for (const def of servers) {
      const existing = this.entries.get(def.id)
      if (!existing) {
        const entry: UpstreamEntry = {
          def,
          client: undefined,
          transport: undefined,
          state: def.enabled ? 'disconnected' : 'disabled',
          tools: [],
          error: undefined,
          lastConnectedAt: undefined,
          reconnectAttempt: 0,
          connecting: undefined,
          refreshTimer: undefined,
          reconnectTimer: undefined,
          closed: false,
          stderrLines: [],
        }
        this.entries.set(def.id, entry)
        this.bus.emit('upstream-status', this.statusOf(entry))
        continue
      }
      const wasEnabled = existing.def.enabled
      existing.def = def
      if (!def.enabled) {
        if (wasEnabled || existing.state !== 'disabled') {
          void this.closeEntry(existing, 'disabled')
        }
        continue
      }
      if (!wasEnabled) {
        // 重新启用：解除主动关闭标记，允许再次连接
        existing.closed = false
        existing.state = 'disconnected'
        this.bus.emit('upstream-status', this.statusOf(existing))
      }
    }
  }

  /** 全部 server 定义 */
  getServerDefs(): McpServerDef[] {
    return [...this.entries.values()].map((entry) => entry.def)
  }

  /** 单个 server 定义 */
  getServerDef(serverId: string): McpServerDef | undefined {
    return this.entries.get(serverId)?.def
  }

  /** 单个 server 的展示名 */
  getServerName(serverId: string): string {
    const def = this.entries.get(serverId)?.def
    return def?.name ?? serverId
  }

  /** 单个 server 的当前状态 */
  getStatus(serverId: string): McpUpstreamStatus | undefined {
    const entry = this.entries.get(serverId)
    if (!entry) return undefined
    return this.statusOf(entry)
  }

  /** 全部 server 的当前状态 */
  getStatuses(): McpUpstreamStatus[] {
    return [...this.entries.values()].map((entry) => this.statusOf(entry))
  }

  /**
   * 某个上游的状态。
   *
   * 附带 oauth 授权状态，供界面显示「未授权 / 等待授权 / 已授权 / 授权失败」。
   */
  statusOf(entry: UpstreamEntry): McpUpstreamStatus {
    const status: McpUpstreamStatus = {
      serverId: entry.def.id,
      state: entry.state,
      tools: entry.tools,
      error: entry.error,
      lastConnectedAt: entry.lastConnectedAt,
      reconnectAttempt: entry.reconnectAttempt,
    }
    if (entry.def.auth === 'oauth') {
      status.oauth = this.oauth?.getStatus(entry.def.id) ?? { state: 'idle' }
    }
    return status
  }

  /** 单个 server 当前已知的工具清单 */
  getTools(serverId: string): McpToolInfo[] {
    return this.entries.get(serverId)?.tools ?? []
  }

  /**
   * 拿到可用的 client：没有连接就惰性建连。
   * 未启用或未知 server 返回 undefined。
   */
  async ensureConnected(serverId: string): Promise<Client | undefined> {
    const entry = this.entries.get(serverId)
    if (!entry) return undefined
    if (!entry.def.enabled) {
      if (entry.state !== 'disabled') this.setState(entry, 'disabled')
      return undefined
    }
    if (entry.state === 'ready' && entry.client) return entry.client
    if (entry.connecting) return entry.connecting

    const pending = this.connect(entry)
    entry.connecting = pending
    try {
      return await pending
    } finally {
      if (entry.connecting === pending) entry.connecting = undefined
    }
  }

  /**
   * 调用上游工具（原始工具名，不带命名空间前缀）。
   */
  async callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const client = await this.ensureConnected(serverId)
    if (!client) throw new Error(`上游 MCP server 不可用：${serverId}`)
    return client.callTool({ name: toolName, arguments: args })
  }

  /**
   * 关闭全部连接。
   */
  async closeAll(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      await this.closeEntry(entry)
    }
  }

  /** 建连 + 握手 + 拉工具清单 */
  private async connect(entry: UpstreamEntry): Promise<Client | undefined> {
    this.setState(entry, 'connecting')
    try {
      // 先确认命令存在：命令不存在时子进程根本起不来，
      // 报错只会是笼统的 Connection closed，看不出真实原因
      if (entry.def.transport === 'stdio' && entry.def.command) {
        const missing = await findMissingCommand(entry.def.command)
        if (missing) {
          throw new Error(
            `找不到命令「${entry.def.command}」${missing}。` + 'stdio 上游需要本机已安装该命令。',
          )
        }
      }
      const transport = this.createTransport(entry.def)
      this.attachStderr(entry, transport)
      const client = new Client({ name: this.clientName, version: this.clientVersion })
      await client.connect(transport)
      entry.transport = transport
      entry.client = client
      entry.lastConnectedAt = new Date().toISOString()
      client.onclose = () => {
        void this.handleClose(entry)
      }
      client.onerror = (error: Error) => {
        this.handleError(entry, error)
      }
      await this.refreshTools(entry)
      this.setState(entry, 'ready')
      this.startRefreshTimer(entry)
      return client
    } catch (error) {
      const detail = errorMessage(error)
      // 子进程的 stderr 往往才是真正的原因（如「缺少必需参数」）
      const stderr = pickStderr(entry.stderrLines)
      const message = stderr ? `${detail}\n${stderr}` : explainUpstreamError(detail, entry.def)
      entry.client = undefined
      entry.transport = undefined
      this.setState(entry, 'error', message)
      this.scheduleReconnect(entry)
      return undefined
    }
  }

  /**
   * 收集 stdio 子进程的 stderr（最近 20 行）。
   *
   * 上游进程常把「用法说明」「缺少参数」写进 stderr 后立即退出，
   * 没有它连接失败只会显示笼统的 Connection closed。
   */
  private attachStderr(entry: UpstreamEntry, transport: Transport): void {
    const stderr = (transport as { stderr?: unknown }).stderr
    if (!stderr || typeof (stderr as NodeJS.ReadableStream).on !== 'function') return
    ;(stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        entry.stderrLines.push(trimmed)
        while (entry.stderrLines.length > 20) entry.stderrLines.shift()
      }
    })
  }

  /** 建 transport：stdio 拉起子进程，http 走 Streamable HTTP */
  private createTransport(def: McpServerDef): Transport {
    if (def.transport === 'stdio') {
      if (!def.command) throw new Error(`stdio 上游缺少 command：${def.id}`)
      return new StdioClientTransport({
        command: def.command,
        args: def.args ?? [],
        env: { ...getDefaultEnvironment(), ...resolveEnvRecord(def.env) },
        // 收集 stderr：上游启动失败时才能看到「缺少参数」这类真实原因
        stderr: 'pipe',
      })
    }
    if (!def.url) throw new Error(`http 上游缺少 url：${def.id}`)
    const headers = resolveEnvRecord(def.headers)
    const url = new URL(resolveEnvPlaceholders(def.url))

    // oauth 模式：把 provider 交给 transport，它会自动带上 bearer 令牌
    if (def.auth === 'oauth' && this.oauth) {
      return new StreamableHTTPClientTransport(url, {
        authProvider: this.oauth.createProvider(def.id, url.toString()),
      })
    }

    return new StreamableHTTPClientTransport(url, {
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    })
  }

  /** 重新拉取工具清单 */
  private async refreshTools(entry: UpstreamEntry): Promise<void> {
    const client = entry.client
    if (!client) return
    const result = await client.listTools()
    entry.tools = result.tools.map((tool) => toToolInfo(entry.def.id, tool))
  }

  /** 定时刷新工具清单 */
  private startRefreshTimer(entry: UpstreamEntry): void {
    this.clearRefreshTimer(entry)
    entry.refreshTimer = setInterval(() => {
      void this.refreshToolsQuietly(entry)
    }, this.toolRefreshIntervalMs)
    entry.refreshTimer.unref()
  }

  private clearRefreshTimer(entry: UpstreamEntry): void {
    if (!entry.refreshTimer) return
    clearInterval(entry.refreshTimer)
    entry.refreshTimer = undefined
  }

  private async refreshToolsQuietly(entry: UpstreamEntry): Promise<void> {
    try {
      await this.refreshTools(entry)
      this.bus.emit('upstream-status', this.statusOf(entry))
    } catch (error) {
      entry.error = errorMessage(error)
      this.bus.emit('upstream-status', this.statusOf(entry))
    }
  }

  /** 连接断开（非主动关闭）→ 安排重连 */
  private async handleClose(entry: UpstreamEntry): Promise<void> {
    if (entry.closed) return
    this.clearRefreshTimer(entry)
    entry.client = undefined
    entry.transport = undefined
    this.setState(entry, 'disconnected')
    this.scheduleReconnect(entry)
  }

  /** 出错（不一定是致命错误），记录错误信息并广播状态 */
  private handleError(entry: UpstreamEntry, error: Error): void {
    if (entry.closed) return
    entry.error = error.message
    this.bus.emit('upstream-status', this.statusOf(entry))
  }

  /** 按指数退避安排一次重连 */
  private scheduleReconnect(entry: UpstreamEntry): void {
    if (entry.closed) return
    if (entry.reconnectTimer) return
    const delay = reconnectDelay(entry.reconnectAttempt)
    entry.reconnectAttempt += 1
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = undefined
      void this.ensureConnected(entry.def.id)
    }, delay)
    entry.reconnectTimer.unref()
  }

  /** 主动关闭一条连接 */
  private async closeEntry(
    entry: UpstreamEntry,
    state: McpUpstreamState = 'disconnected',
    notify = true,
  ): Promise<void> {
    entry.closed = true
    this.clearRefreshTimer(entry)
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = undefined
    }
    const client = entry.client
    entry.client = undefined
    entry.transport = undefined
    if (notify) {
      this.setState(entry, state)
    } else {
      entry.state = state
      entry.error = undefined
    }
    if (client) {
      try {
        await client.close()
      } catch {
        // 关闭失败不影响其它连接
      }
    }
  }

  /** 更新状态并广播 */
  private setState(entry: UpstreamEntry, state: McpUpstreamState, error?: string): void {
    entry.state = state
    entry.error = error
    this.bus.emit('upstream-status', this.statusOf(entry))
  }
}
