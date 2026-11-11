/**
 * 一个真的 MCP 上游（假的），用来验证 AgentCompose 的连接与令牌解析。
 *
 * 要求 Authorization: Bearer <EXPECT_TOKEN>，否则回 401。
 * 用 SDK 的 createMcpHandler —— 与 sidecar 侧同一套 API。
 */
import {
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
} from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createServer } from 'node:http'

const EXPECT = process.env.EXPECT_TOKEN ?? 'SECRET-123'
const PORT = Number(process.env.PORT ?? 9915)

const mcp = new McpServer({ name: 'fake-upstream', version: '1.0.0' })

const handler = createMcpHandler(async () => mcp.server, {
  allowedHosts: localhostAllowedHostnames([PORT]),
  allowedOrigins: localhostAllowedOrigins([PORT]),
  enableDnsRebindingProtection: true,
})

const httpServer = createServer((req, res) => {
  const auth = req.headers.authorization
  console.log(`[fake] ${req.method} ${req.url} auth=${auth ?? '(无)'}`)
  if (auth !== `Bearer ${EXPECT}`) {
    res.writeHead(401, {
      'www-authenticate':
        'Bearer resource_metadata="http://127.0.0.1:9915/.well-known/oauth-protected-resource"',
    })
    res.end()
    return
  }
  void toNodeHandler(handler)(req, res)
})

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[fake] listening on ${PORT}, expect token ${EXPECT}`)
})
