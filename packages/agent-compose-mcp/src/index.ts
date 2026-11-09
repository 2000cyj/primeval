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
import { join } from 'node:path'

import { EventBus } from './events.ts'
import { Store } from './store.ts'
import { ToolRegistry } from './registry.ts'
import { UpstreamPool } from './upstream.ts'
import { SessionManager } from './session.ts'
import { McpHttpServer } from './server.ts'
import { findAvailablePort, generateToken, mcpDataDir } from './config.ts'

/** 落盘的端口文件名 */
const PORT_FILE = 'port'
/** 落盘的令牌文件名 */
const TOKEN_FILE = 'token'

async function main(): Promise<void> {
  const dataDir = mcpDataDir()
  mkdirSync(dataDir, { recursive: true })

  const bus = new EventBus()
  const store = new Store(dataDir, bus)
  const config = await store.load()

  const pool = new UpstreamPool(config.servers, bus)
  const registry = new ToolRegistry(pool)
  const session = new SessionManager(pool, registry, bus)

  // 初始工具集：按当前暴露配置聚合
  registry.buildFromPool(store.getExposure())

  // 令牌：首次启动生成并落盘，之后复用，保证 GUI 重启后 agent 的配置仍有效
  let token = ''
  try {
    const { readFileSync } = await import('node:fs')
    token = readFileSync(join(dataDir, TOKEN_FILE), 'utf8').trim()
  } catch {
    token = ''
  }
  if (!token) {
    token = generateToken()
  }
  writeFileSync(join(dataDir, TOKEN_FILE), token, 'utf8')

  const port = await findAvailablePort()

  const http = new McpHttpServer({
    pool,
    registry,
    session,
    store,
    bus,
    getToken: () => token,
    onShutdown: () => {
      void shutdown(0)
    },
  })

  const actualPort = await http.start(port)
  writeFileSync(join(dataDir, PORT_FILE), String(actualPort), 'utf8')

  console.log(`[agent-compose-mcp] listening on http://127.0.0.1:${actualPort}/mcp`)
  console.log(`[agent-compose-mcp] admin API: http://127.0.0.1:${actualPort}/admin/*`)
  console.log(`[agent-compose-mcp] data dir: ${dataDir}`)

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
