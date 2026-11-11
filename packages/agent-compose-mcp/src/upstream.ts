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
import { resolveSecret, resolveSecretRecord } from './secret.ts'
import type { EventBus } from './events.ts'
import type { OAuthManager } from './oauth.ts'
import type { ToolCacheStore } from './store.ts'
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

/**
 * 这个上游是不是配了固定令牌。
 *
 * `static` 认证的令牌放在 headers（http）或 env（stdio）里，
 * 值可以是字面量，也可以是 `${ENV:NAME}` 占位。
 */
export function hasStaticToken(def: McpServerDef): boolean {
  const inHeaders = Object.entries(def.headers ?? {}).some(
    ([key, value]) => /authorization|token|api[-_]?key|secret/i.test(key) || Boolean(value),
  )
  if (inHeaders) return true
  return Object.keys(def.env ?? {}).some((key) =>
    /authorization|token|api[-_]?key|secret/i.test(key),
  )
}

export type UpstreamPoolOptions = {
  /** oauth 管理器：远程上游用 oauth 授权时需要 */
  oauth?: OAuthManager
  /** 工具清单缓存：连上后把工具落盘，下次不用重连也能看到 */
  toolCache?: ToolCacheStore
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
  if (detail === 'NEEDS_AUTHORIZATION') {
    return '该远程 server 尚未授权：请在浏览器中完成授权后重试。'
  }
  if (def.transport !== 'http') return detail
  if (/Unauthorized|401/i.test(detail)) {
    if (def.auth === 'oauth') {
      return (
        '该远程 server 需要授权：点「测试」在浏览器里完成授权后重试；' +
        '若你手里有长期令牌（PAT），可在「编辑」的「令牌」里直接贴。'
      )
    }
    if (def.auth === 'static') {
      return '该远程 server 拒绝了当前请求（401）：请在「编辑」的「请求头」里补上有效的认证令牌。'
    }
    // auth 是 none —— 最常见的情况：用户压根没意识到这个 server 要认证
    return (
      '该远程 server 拒绝了当前请求（401）：它需要认证信息。' +
      '请到「编辑」把「认证方式」改成「固定令牌」（在请求头里填令牌）' +
      '或「OAuth 授权」（点测试在浏览器里授权）。'
    )
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
  /** 工具清单缓存（落盘） */
  private readonly toolCache: ToolCacheStore | undefined
  private readonly bus: EventBus
  private readonly toolRefreshIntervalMs: number
  private readonly clientName: string
  private readonly clientVersion: string

  constructor(servers: McpServerDef[], bus: EventBus, options?: UpstreamPoolOptions) {
    this.bus = bus
    this.oauth = options?.oauth
    this.toolCache = options?.toolCache
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
    // 没连上时，工具清单读缓存 —— 页面刚打开不该是一片空白
    const live = entry.tools
    const cached = this.cachedTools.get(entry.def.id) ?? []
    const fromCache = live.length === 0 && cached.length > 0
    const status: McpUpstreamStatus = {
      serverId: entry.def.id,
      state: entry.state,
      tools: live.length ? live : cached,
      error: entry.error,
      lastConnectedAt: entry.lastConnectedAt,
      reconnectAttempt: entry.reconnectAttempt,
    }
    if (fromCache) {
      status.toolsFromCache = true
      status.toolsCachedAt = this.cachedAt.get(entry.def.id)
    }
    // 令牌来源：手动配的（字面量 / env 占位）优先于浏览器授权的
    const manual = entry.def.token ? resolveSecret(entry.def.token) : undefined
    if (manual?.value) {
      status.tokenSource = manual.source === 'env' ? 'env' : 'manual'
    } else if (entry.def.auth === 'oauth') {
      status.tokenSource = this.oauth?.getStatus(entry.def.id)?.tokenSource ?? 'none'
    } else {
      // static 认证：令牌在 headers / env 里，也算“手动配的”
      status.tokenSource = hasStaticToken(entry.def) ? 'manual' : 'none'
    }
    if (entry.def.auth === 'oauth') {
      status.oauth = this.oauth?.getStatus(entry.def.id) ?? { state: 'idle' }
    }
    return status
  }

  /**
   * 单个 server 的工具清单。
   *
   * 连上了就返回实时的；没连上（页面刚打开、上游是惰性连接的）返回**上次缓存的** ——
   * 这样用户不用等重连就能看到上次拿到过什么工具。
   */
  getTools(serverId: string): McpToolInfo[] {
    const live = this.entries.get(serverId)?.tools ?? []
    if (live.length) return live
    return this.cachedTools.get(serverId) ?? []
  }

  /** 缓存里的工具清单（同步读，取不到就空） */
  private cachedTools = new Map<string, McpToolInfo[]>()
  /** 缓存时间 */
  private cachedAt = new Map<string, number>()

  /**
   * 从缓存里恢复所有上游的工具清单。
   *
   * sidecar 启动时调一次：这样页面一打开就能显示上次的工具与状态，
   * 不必等每个上游重新连一遍。
   */
  async loadToolCache(cache: ToolCacheStore): Promise<void> {
    const all = await cache.all()
    for (const [serverId, entry] of Object.entries(all)) {
      if (!Array.isArray(entry?.tools)) continue
      this.cachedTools.set(serverId, entry.tools)
      this.cachedAt.set(serverId, entry.cachedAt)
    }
  }

  /** 把工具清单写进缓存 */
  private async cacheTools(serverId: string, tools: McpToolInfo[]): Promise<void> {
    this.cachedTools.set(serverId, tools)
    this.cachedAt.set(serverId, Date.now())
    if (!this.toolCache) return
    try {
      await this.toolCache.write(serverId, tools)
    } catch {
      // 缓存写失败不影响连接
    }
  }

  /**
   * 测一个**还没保存**的上游定义能不能连上。
   *
   * 用户在「新增/编辑」弹窗里填完就想知道能不能用 —— 那时它还没进池子。
   * 这里临时建一条连接、测完就关掉，不动池子里的任何状态。
   *
   * 跟 `ensureConnected` 的区别：后者连的是池子里已保存的那个。
   */
  async probeDef(def: McpServerDef): Promise<{
    ok: boolean
    toolCount: number
    error?: string
  }> {
    const entry: UpstreamEntry = {
      def,
      client: undefined,
      transport: undefined,
      state: 'disconnected',
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
    try {
      const client = await this.connect(entry, { persistent: false })
      if (!client) {
        return { ok: false, toolCount: 0, error: entry.error ?? '连接失败' }
      }
      return { ok: true, toolCount: entry.tools.length }
    } finally {
      // 测完就关：不留连接，也不留重连定时器
      await this.closeEntry(entry, 'disconnected', false)
    }
  }

  /**
   * 把所有启用的上游都连一遍。
   *
   * 上游默认是惰性连接的 —— 不主动连就没状态、没工具清单，
   * 页面打开时一片「未连接」。这里给界面一个主动触发的机会：
   * 连上的结果会通过事件总线推给界面。
   *
   * 不 await：连一个上游可能要好几秒（stdio 还要起子进程），
   * 不能把请求卡住。界面轮询状态就能看到进展。
   */
  connectAll(): void {
    for (const entry of this.entries.values()) {
      if (!entry.def.enabled) continue
      void this.ensureConnected(entry.def.id)
    }
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
  private async connect(
    entry: UpstreamEntry,
    options?: { persistent?: boolean },
  ): Promise<Client | undefined> {
    // persistent = false：只测一下，不长期维持连接，也不安排重连
    const persistent = options?.persistent ?? true
    this.setState(entry, 'connecting')
    try {
      // oauth 上游在拿到令牌前不建连：建连会让 sdk 自动走一遍授权流程，
      // 那会跳浏览器 —— 授权必须由用户主动触发（点「测试连接」或
      // 「授权」），不能被后台的自动重连带着走。
      //
      // 用户手动配了令牌（`def.token`）的除外：它不需要浏览器授权。
      if (entry.def.auth === 'oauth' && this.oauth && !entry.def.token) {
        const hasToken = await this.oauth.hasTokens(entry.def.id)
        if (!hasToken) {
          throw new Error('NEEDS_AUTHORIZATION')
        }
      }

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
      if (persistent) this.startRefreshTimer(entry)
      // 落盘：下次不用重连也能看到工具清单
      if (persistent) await this.cacheTools(entry.def.id, entry.tools)
      return client
    } catch (error) {
      const detail = errorMessage(error)
      // 子进程的 stderr 往往才是真正的原因（如「缺少必需参数」）
      const stderr = pickStderr(entry.stderrLines)
      const message = stderr ? `${detail}\n${stderr}` : explainUpstreamError(detail, entry.def)
      entry.client = undefined
      entry.transport = undefined
      this.setState(entry, 'error', message)
      if (persistent) this.scheduleReconnect(entry)
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
      const env = resolveSecretRecord(def.env)
      if (env.errors.length) {
        throw new Error(`环境变量没配好：${env.errors.join('；')}`)
      }
      return new StdioClientTransport({
        command: def.command,
        args: def.args ?? [],
        env: { ...getDefaultEnvironment(), ...env.values },
        // 收集 stderr：上游启动失败时才能看到「缺少参数」这类真实原因
        stderr: 'pipe',
      })
    }
    if (!def.url) throw new Error(`http 上游缺少 url：${def.id}`)

    // url / headers 里可能带 ${ENV:NAME} 占位符。
    // 解析不出来就在这里停下：把 `${ENV:NAME}` 原样发出去只会让服务端回 401，
    // 用户完全猜不到是环境变量没配。
    const urlSecret = resolveSecret(def.url)
    if (urlSecret.error) {
      throw new Error(`url 里的${urlSecret.error}（配置里写的是 ${def.url}）`)
    }
    const headers = resolveSecretRecord(def.headers)
    if (headers.errors.length) {
      throw new Error(`请求头里的${headers.errors.join('；')}`)
    }

    // 手动配置的令牌（`token` 字段）：字面量或 ${ENV:NAME} 都支持。
    // 它优先于 oauth 流程 —— 用户既然贴了令牌，就不用再去浏览器授权一遍。
    const manualToken = def.token ? resolveSecret(def.token) : undefined
    if (manualToken?.error) {
      throw new Error(`令牌里的${manualToken.error}（配置里写的是 ${def.token}）`)
    }

    // oauth 模式：把 provider 交给 transport，它会自动带上 bearer 令牌
    if (def.auth === 'oauth' && this.oauth && !manualToken) {
      return new StreamableHTTPClientTransport(new URL(urlSecret.value), {
        authProvider: this.oauth.createProvider(def.id, urlSecret.value),
      })
    }

    // 手动令牌：当普通的 Bearer 头发出去
    const finalHeaders = { ...headers.values }
    if (manualToken) {
      finalHeaders['Authorization'] = `Bearer ${manualToken.value}`
    }

    return new StreamableHTTPClientTransport(new URL(urlSecret.value), {
      requestInit: Object.keys(finalHeaders).length > 0 ? { headers: finalHeaders } : undefined,
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
      // 清单变了就同步更新缓存
      await this.cacheTools(entry.def.id, entry.tools)
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
