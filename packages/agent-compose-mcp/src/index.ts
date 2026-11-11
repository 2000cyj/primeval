/**
 * AgentCompose MCP proxy —— sidecar 入口。
 *
 * 角色：
 * - 对**上游** MCP server 是 client（stdio 子进程 / Streamable HTTP）
 * - 对**下游** agent 是 server（`http://127.0.0.1:<port>/mcp`）
 *
 * 启动顺序：
 *   1. 读配置（servers / exposure / profiles）
 *   2. 建连接池、注册表、会话层
 *   3. 分配端口、生成并落盘 token
 *   4. 起 HTTP 服务
 *
 * 端口与 token 落在 `~/.agent-compose/mcp/`（可用 `AGENT_COMPOSE_DATA_DIR` 覆盖），
 * Tauri 侧从同一位置读取，以便把 admin API 的调用转发过来。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { sourceStamp } from './stamp.ts'
import { join } from 'node:path'

import { EventBus } from './events.ts'
import { OAuthFileStore, Store, ToolCacheStore } from './store.ts'
import { OAuthManager } from './oauth.ts'
import { ToolRegistry } from './registry.ts'
import { UpstreamPool } from './upstream.ts'
import { SessionManager } from './session.ts'
import { McpHttpServer } from './server.ts'
import {
  FIXED_TOKEN,
  findAvailablePort,
  isPortAvailable,
  mcpDataDir,
  runtimeDir,
} from './config.ts'

/** 落盘的端口文件名 */
const PORT_FILE = 'port'
/** 落盘的令牌文件名 */
const TOKEN_FILE = 'token'
/** 落盘的运行信息文件名（pid 与源码指纹） */
const RUNTIME_FILE = 'sidecar.json'

/**
 * 读取端口文件并确认该端口仍有人监听。
 *
 * @returns 已有实例的端口；没有可用实例时返回 null
 */
async function readExistingPort(dataDir: string): Promise<number | null> {
  const { readFileSync } = await import('node:fs')
  try {
    const raw = readFileSync(join(dataDir, PORT_FILE), 'utf8').trim()
    const port = Number.parseInt(raw, 10)
    if (!Number.isInteger(port) || port <= 0) return null
    return (await isPortAvailable(port)) ? null : port
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const dataDir = mcpDataDir()
  mkdirSync(dataDir, { recursive: true })

  // 端口与令牌固定落在默认位置，与 gui 侧读取的路径一致
  const runtime = runtimeDir()
  mkdirSync(runtime, { recursive: true })

  const bus = new EventBus()
  const store = new Store(dataDir, bus)
  const config = await store.load()

  const oauthStore = new OAuthFileStore(dataDir)
  const oauth = new OAuthManager(oauthStore, bus)

  // 工具清单缓存：连上过的上游把工具落盘，下次不用重连也能看到
  const toolCache = new ToolCacheStore(dataDir)

  const pool = new UpstreamPool(config.servers, bus, { oauth, toolCache })
  // 恢复上次的工具清单 —— 页面打开时不用等每个上游重新连一遍
  await pool.loadToolCache(toolCache)
  const registry = new ToolRegistry(pool)
  const session = new SessionManager(pool, registry, bus, oauth)

  // 初始工具集：按当前暴露配置聚合
  registry.buildFromPool(store.getExposure())

  // 令牌：固定用产品名（AgentSpace）——
  // agent 接入地址要粘到各个工具的配置里，固定值好记、好核对。
  let token = FIXED_TOKEN
  try {
    const { readFileSync } = await import('node:fs')
    const saved = readFileSync(join(runtime, TOKEN_FILE), 'utf8').trim()
    // 旧版本落盘的是随机串：忽略，改用固定值。
    if (saved === FIXED_TOKEN) token = saved
  } catch {
    token = FIXED_TOKEN
  }

  // 单例：若已有实例在跑（端口文件指向的端口仍有人监听），复用它并退出。
  // 否则两个实例会互相覆盖端口文件，gui 与 agent 可能连到不同的实例。
  const existingPort = await readExistingPort(runtime)
  if (existingPort !== null) {
    console.log(`[agent-compose-mcp] 已有实例在运行（端口 ${existingPort}），本次启动退出`)
    return
  }
  // 注意：令牌文件**不能**在单例检查之前写 ——
  // 否则本实例会退出去，让 gui 拿着本实例的令牌去问那个真正在跑的实例（401）。
  // 所以等下面真的绑上端口了再落盘。

  const port = await findAvailablePort()

  const http = new McpHttpServer({
    pool,
    registry,
    session,
    store,
    bus,
    oauth,
    getToken: () => token,
    setToken: (next: string) => {
      token = next
      // 落盘：gui 侧只认这个文件，两边必须一致。
      try {
        writeFileSync(join(runtime, TOKEN_FILE), token, 'utf8')
      } catch {
        // 落盘失败不影响运行中的实例（内存里已经换掉了）
      }
    },
    onShutdown: () => {
      void shutdown(0)
    },
  })

  const actualPort = await http.start(port)
  writeFileSync(join(runtime, PORT_FILE), String(actualPort), 'utf8')
  // 令牌落盘：gui 侧只认这个文件，必须与本实例实际用的令牌一致。
  writeFileSync(join(runtime, TOKEN_FILE), token, 'utf8')

  // 记录 pid 与源码指纹：调用方据此判断运行中的实例是否还对应当前代码
  writeFileSync(
    join(runtime, RUNTIME_FILE),
    JSON.stringify({
      pid: process.pid,
      sourceStamp: sourceStamp(join(import.meta.dirname, '..', 'src')),
      startedAt: new Date().toISOString(),
    }),
    'utf8',
  )

  // 端口确定后补上 oauth 回调地址
  oauth.setBaseUrl(`http://127.0.0.1:${actualPort}`)

  console.log(`[agent-compose-mcp] listening on http://127.0.0.1:${actualPort}/mcp`)
  console.log(`[agent-compose-mcp] admin API: http://127.0.0.1:${actualPort}/admin/*`)
  console.log(`[agent-compose-mcp] data dir: ${dataDir}`)
  console.log(`[agent-compose-mcp] runtime dir: ${runtime}`)

  let shuttingDown = false
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('[agent-compose-mcp] shutting down…')
    await http.stop().catch(() => undefined)
    pool.closeAll()
    process.exit(code)
  }

  process.on('SIGINT', () => {
    void shutdown(0)
  })
  process.on('SIGTERM', () => {
    void shutdown(0)
  })
}

main().catch((error) => {
  console.error('[agent-compose-mcp] 启动失败：', error)
  process.exit(1)
})
