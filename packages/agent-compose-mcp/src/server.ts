/**
 * sidecar 的 HTTP 层：
 *
 * - `/mcp*`  → 对 agent 暴露的 MCP 端点（粒度由路径表达）
 * - `/admin/*` → 给 Tauri GUI 调用的管理接口
 *
 * 协议实现交给 `@modelcontextprotocol/server` 的 `createMcpHandler`，
 * Node 适配交给 `@modelcontextprotocol/node` 的 `toNodeHandler`。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  validateHostHeader,
  validateOriginHeader,
} from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { EventBus } from './events.ts'
import type { Store } from './store.ts'
import type { ToolRegistry } from './registry.ts'
import type { SessionManager } from './session.ts'
import type { UpstreamPool } from './upstream.ts'
import type { McpProfile, McpRuntimeStatus, McpServerDef } from './types.ts'
import { parseSelection } from './session.ts'
import { entryToServerDef, fetchRegistryEntry, searchRegistry } from './registry-client.ts'
import { FIXED_TOKEN } from './config.ts'
import type { OAuthManager } from './oauth.ts'

/** server 层依赖 */
export type McpHttpDeps = {
  pool: UpstreamPool
  registry: ToolRegistry
  session: SessionManager
  store: Store
  bus: EventBus
  /** oauth 管理器：远程上游的授权码流程 */
  oauth: OAuthManager
  /** 当前 Bearer 令牌 */
  getToken: () => string
  /** 换掉 Bearer 令牌（刷新 token 时用） */
  setToken?: (token: string) => void
  /** 触发关闭 */
  onShutdown?: () => void
}

/** 读取请求体（带大小上限） */
async function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 写 JSON 响应 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 校验 Bearer 令牌（也接受 `?token=` query，兼容只支持 URL 传参的客户端） */
function checkToken(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ') && header.slice(7) === token) return true
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    return url.searchParams.get('token') === token
  } catch {
    return false
  }
}

/** Origin / Host 校验（防 DNS rebinding） */
function checkOriginAndHost(req: IncomingMessage): string | null {
  const origin = req.headers.origin
  if (origin) {
    const result = validateOriginHeader(origin, localhostAllowedOrigins())
    if (!result.ok) return result.message ?? 'Origin 不被允许'
  }
  const host = req.headers.host
  if (host) {
    const result = validateHostHeader(host, localhostAllowedHostnames())
    if (!result.ok) return result.message ?? 'Host 不被允许'
  }
  return null
}

export class McpHttpServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private mcpHandler: ReturnType<typeof createMcpHandler> | null = null
  private readonly deps: McpHttpDeps
  /** 活跃 TCP 连接数（node 的 getConnections 只有回调风格，这里自行计数） */
  private activeConnections = 0

  constructor(deps: McpHttpDeps) {
    this.deps = deps
  }

  /** 启动 HTTP 服务，返回实际监听端口 */
  async start(port: number, host = '127.0.0.1'): Promise<number> {
    const { registry, session, store } = this.deps

    // v2 的 createMcpHandler 是 per-request factory：每个请求建一个 Server 实例，
    // 因此天然无状态 —— 粒度完全由 URL 决定，不需要 session 上下文。
    this.mcpHandler = createMcpHandler(async (ctx) => {
      const request = ctx.requestInfo
      const pathname = request ? new URL(request.url).pathname : '/mcp'
      const selection = parseSelection(pathname)
      const view = session.buildView(selection, store.getProfiles())
      // 工具集随上游变化，路由表由 registry 统一维护
      registry.buildFromPool(store.getExposure())
      return session.createServer(view)
    })

    const mcpNodeHandler = toNodeHandler(this.mcpHandler, {
      onerror: (error) => {
        console.error('[mcp] handler error:', error)
      },
    })

    this.httpServer = createServer((req, res) => {
      const pathname = (req.url ?? '/').split('?')[0] ?? '/'

      if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
        const rejection = checkOriginAndHost(req)
        if (rejection) {
          sendJson(res, 403, { error: rejection })
          return
        }
        if (!checkToken(req, this.deps.getToken())) {
          res.writeHead(401, {
            'Content-Type': 'application/json; charset=utf-8',
            'WWW-Authenticate': 'Bearer',
          })
          res.end(JSON.stringify({ error: '缺少或无效的 Bearer 令牌' }))
          return
        }
        mcpNodeHandler(req, res)
        return
      }

      if (pathname === '/oauth/callback') {
        // 浏览器回调：不带令牌（浏览器没有我们的 bearer token）
        void this.handleOAuthCallback(req, res)
        return
      }

      if (pathname.startsWith('/admin/')) {
        void this.handleAdmin(req, res, pathname)
        return
      }

      sendJson(res, 404, { error: '未知路径' })
    })

    this.httpServer.on('connection', (socket) => {
      this.activeConnections += 1
      socket.once('close', () => {
        this.activeConnections = Math.max(0, this.activeConnections - 1)
      })
    })

    // SSE 长连接不能被默认超时切断
    this.httpServer.keepAliveTimeout = 0
    this.httpServer.headersTimeout = 0

    const server = this.httpServer
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => resolve())
    })

    const address = this.httpServer.address()
    return typeof address === 'object' && address ? address.port : port
  }

  /** 停止 HTTP 服务 */
  async stop(): Promise<void> {
    if (this.mcpHandler) {
      await this.mcpHandler.close().catch(() => undefined)
      this.mcpHandler = null
    }
    if (this.httpServer) {
      const server = this.httpServer
      await new Promise<void>((resolve) => server.close(() => resolve()))
      this.httpServer = null
    }
  }

  /** 当前活跃 HTTP 连接数（作为「在线 session」的近似指标） */
  getActiveConnections(): number {
    return this.activeConnections
  }

  // ── oauth 回调 ───────────────────────────────────────────

  /**
   * 处理浏览器回调：用授权码换令牌。
   *
   * 浏览器回调不带我们的 bearer token（它是网页跳转），因此这个路由
   * 不做令牌校验；安全性由 state 参数与本地监听地址保证。
   */
  private async handleOAuthCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const serverId = url.searchParams.get('serverId')

    if (!code || !serverId) {
      sendJson(res, 400, { error: '回调缺少 code 或 serverId' })
      return
    }

    const def = this.deps.store.getServers().find((item) => item.id === serverId)
    if (!def?.url) {
      sendJson(res, 404, { error: `找不到上游：${serverId}` })
      return
    }

    try {
      await this.deps.oauth.handleCallback(serverId, def.url, code)
      const html =
        '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
        '<title>授权完成</title></head>' +
        '<body style="font-family:system-ui;padding:40px;line-height:1.7">' +
        '<h2 style="margin:0 0 8px">授权完成</h2>' +
        '<p style="margin:0;color:#6b7280">可以关闭此页面，回到 AgentCompose 继续。</p>' +
        '</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 400, { error: message })
    }
  }

  // ── admin API ─────────────────────────────────────────────

  private async handleAdmin(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const { pool, registry, session, store, bus } = this.deps
    const method = req.method ?? 'GET'

    if (!checkToken(req, this.deps.getToken())) {
      sendJson(res, 401, { error: '缺少或无效的 Bearer 令牌' })
      return
    }

    try {
      // 状态
      if (pathname === '/admin/status' && method === 'GET') {
        const status: McpRuntimeStatus = {
          endpoint: `http://127.0.0.1:${this.portHint()}`,
          token: this.deps.getToken(),
          port: this.portHint(),
          sessions: this.getActiveConnections(),
          upstreams: pool.getStatuses(),
          exposure: store.getExposure(),
          profiles: store.getProfiles(),
        }
        sendJson(res, 200, status)
        return
      }

      // 刷新令牌：让运行中的实例立刻用上当前的 token（sidecar 重启过、
      // 或 token 文件被手工改过时用得上）。
      if (pathname === '/admin/token' && method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { token?: string }
        const token = body.token?.trim() || FIXED_TOKEN
        this.deps.setToken?.(token)
        sendJson(res, 200, { token: this.deps.getToken() })
        return
      }

      // 上游 server 列表
      if (pathname === '/admin/servers' && method === 'GET') {
        sendJson(res, 200, {
          servers: store.getServers(),
          statuses: pool.getStatuses(),
        })
        return
      }

      if (pathname === '/admin/servers' && method === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}') as { servers?: McpServerDef[] }
        const servers = body.servers ?? []
        await store.setServers(servers)
        pool.setServers(servers)
        registry.buildFromPool(store.getExposure())
        bus.emit('config-changed', { kind: 'servers' })
        // 刚保存的上游：重新连一遍，把最新的工具清单落盘。
        // 不 await —— 连上游可能要几秒，不能把保存请求卡住。
        pool.connectAll()
        res.writeHead(204)
        res.end()
        return
      }

      // 删除单个 server
      if (pathname.startsWith('/admin/servers/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/admin/servers/'.length))
        const next = store.getServers().filter((item) => item.id !== id)
        await store.setServers(next)
        pool.setServers(next)
        const exposure = store.getExposure()
        await store.setExposure({
          ...exposure,
          serverIds: exposure.serverIds.filter((item) => item !== id),
          toolKeys: exposure.toolKeys.filter((key) => !key.startsWith(`${id}::`)),
        })
        registry.buildFromPool(store.getExposure())
        bus.emit('config-changed', { kind: 'servers' })
        res.writeHead(204)
        res.end()
        return
      }

      // 发起 oauth 授权
      if (
        pathname.endsWith('/authorize') &&
        pathname.startsWith('/admin/servers/') &&
        method === 'POST'
      ) {
        const id = decodeURIComponent(
          pathname.slice('/admin/servers/'.length, pathname.length - '/authorize'.length),
        )
        const def = store.getServers().find((item) => item.id === id)
        if (!def) {
          sendJson(res, 404, { error: `找不到上游：${id}` })
          return
        }
        if (!def.url) {
          sendJson(res, 400, { error: '只有 http 上游支持 oauth 授权' })
          return
        }
        const result = await this.deps.oauth.startAuthorization(id, def.url)
        sendJson(res, 200, {
          authorizeUrl: result.authorizeUrl,
          scope: result.scope,
          state: 'pending',
        })
        return
      }

      // 把所有启用的上游都连一遍
      //
      // 上游默认惰性连接：页面打开时全是「未连接」。
      // 界面调它来主动建连（结果通过状态轮询看到）。
      if (pathname === '/admin/servers/connect' && method === 'POST') {
        pool.connectAll()
        sendJson(res, 202, { ok: true })
        return
      }

      // 测一个还没保存的上游定义（新增/编辑弹窗里的「测试」按钮）
      if (pathname === '/admin/servers/probe' && method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { server?: unknown }
        const def = body.server as McpServerDef | undefined
        if (!def || typeof def.id !== 'string' || !def.id) {
          sendJson(res, 400, { error: '缺少 server 定义' })
          return
        }
        const probe = await session.probeDef(def)
        sendJson(res, 200, {
          serverId: def.id,
          ok: probe.ok,
          state: probe.ok ? 'ready' : 'error',
          tools: probe.toolCount,
          error: probe.error,
          authorizeUrl: probe.authorizeUrl,
          tokenSource: probe.tokenSource,
        })
        return
      }

      // 测试连接
      if (
        pathname.endsWith('/test') &&
        pathname.startsWith('/admin/servers/') &&
        method === 'POST'
      ) {
        const id = decodeURIComponent(
          pathname.slice('/admin/servers/'.length, pathname.length - '/test'.length),
        )
        const probe = await session.probe(id)
        const status = pool.getStatus(id)
        const payload = status ?? {
          serverId: id,
          state: 'disconnected',
          tools: [],
          reconnectAttempt: 0,
        }

        // probe 自己发现的错误（env 没配、令牌无效……）要带到结果里。
        // 不带的话：pool 那边根本没建连，状态停在「未连接」且没有错误，
        // 用户只看到「未连接」，完全不知道是哪里配错了。
        if (probe.error && !payload.error) {
          payload.error = probe.error
          payload.state = 'error'
        }

        // oauth 上游尚未授权：把授权地址一并返回，界面据此打开浏览器
        // 让用户人工授权（授权必须由人完成，不能自动绕过）
        if (probe.authorizeUrl) {
          payload.oauth = {
            state: 'pending',
            authorizeUrl: probe.authorizeUrl,
          }
          // 需要授权不是错误：状态保持「未连接」，由界面引导去授权
          payload.state = 'disconnected'
          delete payload.error
        }
        // 令牌来源：手动配置 / 环境变量 / 浏览器授权 / 无
        // 界面据此显示「令牌来自环境变量 XXX」还是「手动配置的」
        if (probe.tokenSource) {
          payload.tokenSource = probe.tokenSource
        }
        sendJson(res, 200, payload)
        return
      }

      // 官方目录搜索
      if (pathname === '/admin/registry/search' && method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const query = url.searchParams.get('query') ?? ''
        const cursor = url.searchParams.get('cursor') ?? undefined
        const result = await searchRegistry(query, cursor)
        // 附带「能否直接落地为上游定义」的判断，前端据此决定是否可一键添加
        sendJson(res, 200, {
          ...result,
          entries: result.entries.map((entry) => {
            const def = entryToServerDef(entry)
            return { ...entry, installable: def !== null, def: def ?? undefined }
          }),
        })
        return
      }

      // 按名字取目录里的一条
      //
      // 数据管理导入时用 —— 导出包里记的是目录条目名（如 io.github.owner/repo），
      // 导入方要拿回完整定义才能建出上游。
      if (pathname.startsWith('/admin/registry/entry') && method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const name = url.searchParams.get('name') ?? ''
        const entry = await fetchRegistryEntry(name)
        if (!entry) {
          sendJson(res, 404, { error: `目录里没有「${name}」` })
          return
        }
        const def = entryToServerDef(entry)
        sendJson(res, 200, {
          entry: { ...entry, installable: def !== null, def: def ?? undefined },
        })
        return
      }

      // 暴露配置
      if (pathname === '/admin/exposure' && method === 'GET') {
        sendJson(res, 200, store.getExposure())
        return
      }
      if (pathname === '/admin/exposure' && method === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}') as { exposure?: unknown }
        if (body.exposure) {
          await store.setExposure(body.exposure as Parameters<Store['setExposure']>[0])
          registry.buildFromPool(store.getExposure())
          bus.emit('config-changed', { kind: 'exposure' })
        }
        res.writeHead(204)
        res.end()
        return
      }

      // Profile
      if (pathname === '/admin/profiles' && method === 'GET') {
        sendJson(res, 200, store.getProfiles())
        return
      }
      if (pathname === '/admin/profiles' && method === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}') as { profiles?: McpProfile[] }
        await store.setProfiles(body.profiles ?? [])
        bus.emit('config-changed', { kind: 'profiles' })
        res.writeHead(204)
        res.end()
        return
      }

      // SSE 事件流
      if (pathname === '/admin/events' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        const write = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }
        const offStatus = bus.on('upstream-status', (payload) => write('upstream-status', payload))
        const offCall = bus.on('call-log', (payload) => write('call-log', payload))
        const offConfig = bus.on('config-changed', (payload) => write('config-changed', payload))
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000)
        req.on('close', () => {
          clearInterval(keepAlive)
          offStatus()
          offCall()
          offConfig()
        })
        return
      }

      // 关闭 sidecar
      if (pathname === '/admin/shutdown' && method === 'POST') {
        sendJson(res, 200, { ok: true })
        setTimeout(() => this.deps.onShutdown?.(), 50)
        return
      }

      sendJson(res, 404, { error: '未知 admin 路径' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 500, { error: message })
    }
  }

  /** 记录当前端口，供 status 使用 */
  private portHint(): number {
    const address = this.httpServer?.address()
    return typeof address === 'object' && address ? address.port : 0
  }
}
