/* eslint-disable @typescript-eslint/no-explicit-any */
// AgentSpace MCP bridge —— Pi 扩展
//
// 把 AgentSpace MCP 代理上的上游工具注册成 Pi 的工具。
//
// 数据来源是项目里的 `.pi/mcp.json` —— 那份配置由 `agentspace run` 写成，
// 每个绑定的上游一条：
//
//   {
//     "mcpServers": {
//       "context-mode": {
//         "type": "http",
//         "url": "http://127.0.0.1:7801/mcp/s/context-mode",
//         "headers": { "Authorization": "Bearer AgentSpace" }
//       }
//     }
//   }
//
// 为什么不直接用 pi 自带的 MCP 支持：
// - 自带的 MCP 扩展可能被别的扩展顶掉（`pi-mcp-adapter` 就注册了 `/mcp`，
//   内置的 mcp 因此不加载）；
// - 自己连还能控制工具名前缀、超时、重连和 footer 状态。
//
// 工具名跟 pi 原生 MCP 一致：`mcp__<server>__<tool>`。
//
// 安装（用 agentspace 命令行）：
//   agentspace extension create agentspace-mcp-bridge --force
//   agentspace extension deps agentspace-mcp-bridge @modelcontextprotocol/sdk typebox
//   agentspace extension write agentspace-mcp-bridge --file index.ts

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Type } from 'typebox'

// ── 配置 ────────────────────────────────────────────────────

/** 探测间隔：远端上游可能中途挂掉（IDE 的 mcp-proxy 停了之类）。 */
const PROBE_INTERVAL_MS = 30_000
/** 单次探测超时。 */
const PROBE_TIMEOUT_MS = 5_000
/** 连接超时。 */
const CONNECT_TIMEOUT_MS = 15_000
/** 重连尝试次数与间隔。 */
const RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAYS = [0, 1000, 2000]

/** MCP 配置里的一条 server。 */
type ServerSpec = {
  name: string
  url: string
  headers?: Record<string, string>
  description?: string
  exposure?: string
}

/** 扩展文件所在目录（index.ts 所在的那层）。 */
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 找 `.pi/mcp.json`。
 *
 * 扩展落在项目的 `.pi/extensions/<name>/` 下，所以上一层的上一层的
 * `mcp.json` 就是它。也认一下 `AGENTSPACE_MCP_CONFIG` 环境变量 ——
 * 指着别的文件时用它。
 */
function findMcpConfig(): string | null {
  const override = process.env.AGENTSPACE_MCP_CONFIG
  if (override && existsSync(override)) return override

  // .pi/extensions/<name>/ → .pi/mcp.json
  const sibling = resolve(EXTENSION_DIR, '..', 'mcp.json')
  if (existsSync(sibling)) return sibling

  // 再往上一层找（扩展被直接放在 .pi/ 下时）
  const parent = resolve(EXTENSION_DIR, '..', '..', 'mcp.json')
  if (existsSync(parent)) return parent

  return null
}

/** 读 `.pi/mcp.json`，取出能连的 server。 */
function loadServers(): ServerSpec[] {
  const path = findMcpConfig()
  if (!path) return []

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return []
  }

  let doc: any
  try {
    doc = JSON.parse(raw)
  } catch {
    return []
  }

  const servers = doc?.mcpServers
  if (!servers || typeof servers !== 'object') return []

  const out: ServerSpec[] = []
  for (const [name, value] of Object.entries(servers)) {
    if (!value || typeof value !== 'object') continue
    const spec = value as Record<string, unknown>

    // 只认 streamable http —— AgentSpace 代理写出来的就是这个形态
    const type = typeof spec.type === 'string' ? spec.type : undefined
    const url = typeof spec.url === 'string' ? spec.url : undefined
    if (!url) continue
    if (type && type !== 'http' && type !== 'streamable-http') continue

    const headers: Record<string, string> = {}
    if (spec.headers && typeof spec.headers === 'object') {
      for (const [key, item] of Object.entries(spec.headers as Record<string, unknown>)) {
        if (typeof item === 'string') headers[key] = item
      }
    }

    out.push({
      name,
      url,
      headers: Object.keys(headers).length ? headers : undefined,
      description: typeof spec.description === 'string' ? spec.description : undefined,
      exposure: typeof spec.exposure === 'string' ? spec.exposure : undefined,
    })
  }
  return out
}

/** 给 Promise 加超时。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

// ── 扩展主体 ────────────────────────────────────────────────

export default async function (pi: any) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

  const servers = loadServers()
  if (servers.length === 0) {
    pi.log?.('agentspace-mcp-bridge: 没找到 .pi/mcp.json —— 没有要桥接的 MCP')
    return
  }

  // 每个 server 的连接状态（footer 上显示）
  const results: Array<{ name: string; ok: boolean; tools: number }> = []
  // 活着的 client —— 探测时用来判断是不是断了
  const clientByName: Record<string, any> = {}
  // session 上下文 —— 只在 session_start 之后用
  let statusCtx: any = null
  let probeTimer: ReturnType<typeof setInterval> | undefined

  /**
   * pi 在 session 被替换时会作废上下文（/reload、换会话…）。
   * 碰一下就抛 "This extension ctx is stale" —— 而探测跑在定时器回调里，
   * 抛出去就是「pi crashed」。所以每次用之前先过这道 guard。
   */
  const liveStatusCtx = () => {
    if (!statusCtx) return null
    try {
      const ui = statusCtx.ui
      if (!ui) {
        statusCtx = null
        return null
      }
      return statusCtx
    } catch {
      statusCtx = null
      return null
    }
  }

  const stopProbe = () => {
    if (probeTimer) {
      clearInterval(probeTimer)
      probeTimer = undefined
    }
  }

  const refreshStatus = () => {
    const ctx = liveStatusCtx()
    if (!ctx) return
    try {
      const theme = ctx.ui.theme
      const parts = results.map((item) =>
        item.ok
          ? theme.fg('dim', `✓ ${item.name}(${item.tools})`)
          : theme.fg('warning', `✗ ${item.name}`),
      )
      ctx.ui.setStatus('agentspace-mcp', parts.join('  '))
      if (process.env.AGENTSPACE_MCP_DEBUG) {
        console.error('[agentspace-mcp-bridge] status:', parts.join('  '))
      }
    } catch {
      statusCtx = null
    }
  }

  /** 建 transport。 */
  const buildTransport = (spec: ServerSpec) =>
    new StreamableHTTPClientTransport(new URL(spec.url), {
      requestInit: { headers: spec.headers ?? {} },
    })

  /** 连一个 server，把它的工具注册进来。 */
  const connect = async (spec: ServerSpec): Promise<boolean> => {
    let lastError: unknown
    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
      const delay = RECONNECT_DELAYS[attempt] ?? 0
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))

      const client = new Client(
        { name: `agentspace-mcp-${spec.name}`, version: '1.0.0' },
        { capabilities: {} },
      )
      try {
        await withTimeout(
          client.connect(buildTransport(spec)),
          CONNECT_TIMEOUT_MS,
          `agentspace-mcp: ${spec.name} 连接（第 ${attempt + 1}/${RECONNECT_ATTEMPTS} 次）`,
        )
        const listed = await withTimeout(
          client.listTools(),
          PROBE_TIMEOUT_MS,
          `agentspace-mcp: ${spec.name} 取工具清单`,
        )
        registerTools(spec, client, listed)
        clientByName[spec.name] = client
        const count = (listed.tools ?? []).length
        pi.log?.(`agentspace-mcp: ${spec.name} 已连接，注册 ${count} 个工具`)
        const entry = results.find((item) => item.name === spec.name)
        if (entry) {
          entry.ok = true
          entry.tools = count
        }
        // 连上一个就报一个 —— 不然要等全部连完 footer 才更新
        refreshStatus()
        return true
      } catch (error: any) {
        lastError = error
        pi.log?.(
          `agentspace-mcp: ${spec.name} 连接失败（第 ${attempt + 1}/${RECONNECT_ATTEMPTS} 次）：${error?.message ?? error}`,
        )
        await client.close().catch(() => {})
      }
    }
    pi.log?.(
      `agentspace-mcp: ${spec.name} 连不上（${RECONNECT_ATTEMPTS} 次都失败：${lastError?.message ?? lastError}）`,
    )
    const entry = results.find((item) => item.name === spec.name)
    if (entry) {
      entry.ok = false
      entry.tools = 0
    }
    return false
  }

  /**
   * 工具名前缀。
   *
   * pi 的 MCP 工具名是 `mcp__<server>__<tool>`，但 server 名里的连字符
   * 要换成下划线（pi 那边就是这么干的，比如 `mcp__context_mode`）——
   * 工具名只认字母数字下划线。
   */
  function toolPrefix(server: string): string {
    return `mcp__${server.replace(/[^A-Za-z0-9_]/g, '_')}__`
  }

  /** 把上游的工具注册成 pi 的工具。 */
  const registerTools = (spec: ServerSpec, client: any, listed: any) => {
    for (const tool of listed.tools ?? []) {
      const fullName = `${toolPrefix(spec.name)}${tool.name}`
      // MCP 给的是 JSON Schema，pi 要 TypeBox。
      // typebox 的 Type.Unsafe 直接吃 JSON Schema —— 不用自己转。
      let parameters: any
      try {
        parameters =
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? Type.Unsafe(tool.inputSchema)
            : Type.Object({}, { additionalProperties: true })
      } catch {
        parameters = Type.Object({}, { additionalProperties: true })
      }

      pi.registerTool({
        name: fullName,
        label: tool.name,
        description: tool.description ?? `AgentSpace MCP 代理上的 ${spec.name} / ${tool.name}`,
        parameters,
        async execute(_toolCallId: string, params: any) {
          const result = await client.callTool({ name: tool.name, arguments: params })
          return {
            content: result?.content ?? [],
            details: result,
          }
        },
      })
    }
  }

  // ── 连接所有 server ──────────────────────────────────────
  //
  // 连接放在 session_start 里做，不在扩展加载时。
  //
  // 原因：footer 状态靠 session_start 给的 ctx.ui.setStatus 渲染。
  // 加载阶段就开连的话，session_start 触发时连接还没完 —— 刷出来的是
  // 一排初始的 ✗，而连完之后的刷新又因为 ctx 还没就绪而落空。
  //
  // 这里不在 session_start 里 await —— 连接要好几秒，await 会把界面卡住。
  // 后台连，连完一个刷一个。
  const connectAll = async () => {
    for (const spec of servers) {
      if (!results.some((item) => item.name === spec.name)) {
        results.push({ name: spec.name, ok: false, tools: 0 })
      }
      await connect(spec)
    }
    refreshStatus()
  }

  let connecting = false

  // ── 探测：中途挂掉的 server 要能自己回来 ──────────────────
  //
  // 远端上游会掉（IDE 的 mcp-proxy 停了之类）。启动时的结果数组是死的，
  // footer 上的 ✓ / ✗ 会说谎。所以定期探一下：
  //   - 活着但之前是 ✗ → 恢复了，重连并重新注册工具
  //   - 之前是 ✓ 但现在不通 → 掉了，把 client 关掉
  //
  // 探活用「有没有拿到响应」，不是「状态码是不是 2xx」：
  // MCP 的 streamable http 端点只接受 POST，对 GET 一般回 405 ——
  // 那恰恰说明服务活着，只是这个方法不允许。早先按 `res.ok` 判，
  // 结果每个 server 都被误判成挂了，footer 全是 ✗。
  const httpAlive = async (url: string): Promise<boolean> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      await fetch(url, { method: 'GET', signal: controller.signal })
      return true
    } catch {
      // 连不上（连接拒绝 / 超时 / DNS 不对）才算不通
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  const probeOnce = async () => {
    let dirty = false
    for (const item of results) {
      const spec = servers.find((s) => s.name === item.name)
      if (!spec) continue

      // 手里有活着的 client —— 用协议级探测（工具清单还能不能拿到），
      // 这样也能发现「HTTP 通但 MCP 会话死了」的情况。
      // 没有 client 才退回 HTTP 探活。
      const client = clientByName[spec.name]
      let alive: boolean
      if (client) {
        try {
          await withTimeout(
            client.listTools(),
            PROBE_TIMEOUT_MS,
            `agentspace-mcp: ${spec.name} 探测`,
          )
          alive = true
        } catch {
          alive = false
        }
      } else {
        alive = await httpAlive(spec.url)
      }

      if (alive && !item.ok) {
        pi.log?.(`agentspace-mcp: ${spec.name} 恢复了，重连中…`)
        if (await connect(spec)) dirty = true
      } else if (!alive && item.ok) {
        item.ok = false
        item.tools = 0
        pi.log?.(`agentspace-mcp: ${spec.name} 不通了`)
        const dead = clientByName[spec.name]
        if (dead) {
          delete clientByName[spec.name]
          dead.close().catch(() => {})
        }
        dirty = true
      }
    }
    if (dirty) refreshStatus()
  }

  // 定时器回调里抛异常 = 未捕获异常 = pi 报崩。探测会做网络 IO、
  // 也会碰到可能过期的上下文，所以绝不能 reject。
  const probe = async () => {
    try {
      await probeOnce()
    } catch (error: any) {
      pi.log?.(`agentspace-mcp: 探测失败：${error?.message ?? error}`)
    }
  }

  pi.on('session_start', (_event: any, ctx: any) => {
    statusCtx = ctx
    refreshStatus()
    // 后台连 —— 不 await，界面不能被连接卡住
    if (!connecting) {
      connecting = true
      void connectAll().finally(() => {
        connecting = false
        refreshStatus()
      })
    }
    if (!probeTimer) probeTimer = setInterval(probe, PROBE_INTERVAL_MS)
  })

  // 事件真名是 session_shutdown（没有 session_end）。
  // 之前监听了不存在的名字，/reload 之后定时器还活着，
  // 拿着作废的上下文跑 —— 这就是「pi crashed」的直接原因。
  pi.on('session_shutdown', () => {
    stopProbe()
    statusCtx = null
    for (const client of Object.values(clientByName)) {
      client?.close?.().catch?.(() => {})
    }
    // 状态归零 —— 下个 session 重新连，不拿旧结果说事
    for (const item of results) {
      item.ok = false
      item.tools = 0
    }
  })

  // 会话被替换前先通知。这几个事件里只丢掉上下文（探测定时器由
  // session_shutdown 停），所以取消替换最多损失一次 footer 刷新。
  for (const event of ['session_before_switch', 'session_before_fork', 'session_before_tree']) {
    pi.on(event, () => {
      statusCtx = null
    })
  }
}
