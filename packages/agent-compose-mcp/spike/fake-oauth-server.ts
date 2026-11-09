/**
 * 模拟一个需要 oauth 2.1 授权的远程 mcp server。
 *
 * 用来验证 sidecar 的 oauth 全流程：动态客户端注册 → 授权地址 →
 * 回调换令牌 → 带令牌连接成功。
 *
 * 用法：node --experimental-strip-types spike/fake-oauth-server.ts
 * 端口 9901。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const PORT = 9901
const BASE = `http://127.0.0.1:${PORT}`
/** 已注册的客户端 */
let registeredClient: { client_id: string; client_secret?: string } | null = null
/** 授权码 → 校验器和客户端 */
const codes = new Map<string, { challenge: string; clientId: string }>()

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  const path = url.pathname

  // ── mcp 端点：没令牌就 401，并给出授权挑战 ──
  if (path === '/mcp') {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource", scope="mcp:connect"`,
      })
      res.end('Unauthorized')
      return
    }
    const body = await readBody(req)
    const request = body ? (JSON.parse(body) as { id?: number; method?: string }) : {}
    if (request.method === 'initialize') {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-oauth-mcp', version: '0.0.1' },
        },
      })
      return
    }
    if (request.method === 'tools/list') {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            {
              name: 'ping',
              description: '回显一句话',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
            },
          ],
        },
      })
      return
    }
    sendJson(res, 200, { jsonrpc: '2.0', id: request.id, result: {} })
    return
  }

  // ── 资源服务器元数据 ──
  if (path === '/.well-known/oauth-protected-resource') {
    sendJson(res, 200, {
      resource: `${BASE}/mcp`,
      authorization_servers: [BASE],
      scopes_supported: ['mcp:connect'],
    })
    return
  }

  // ── 授权服务器元数据 ──
  if (path === '/.well-known/oauth-authorization-server') {
    sendJson(res, 200, {
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      scopes_supported: ['mcp:connect'],
    })
    return
  }

  // ── 动态客户端注册 ──
  if (path === '/register' && req.method === 'POST') {
    const body = await readBody(req)
    const meta = body ? (JSON.parse(body) as { client_name?: string }) : {}
    registeredClient = { client_id: 'fake-client-123', client_secret: 'fake-secret' }
    console.log(`[fake] 动态注册成功：${meta.client_name ?? '(未命名)'}`)
    sendJson(res, 201, {
      ...registeredClient,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: ['http://127.0.0.1:7801/oauth/callback'],
    })
    return
  }

  // ── 授权端点：直接发码并跳转回 redirect_uri ──
  if (path === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const challenge = url.searchParams.get('code_challenge') ?? ''
    const clientId = url.searchParams.get('client_id') ?? ''
    const code = `code-${Date.now()}`
    codes.set(code, { challenge, clientId })
    const target = `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    console.log(`[fake] 授权 → 跳转 ${target}`)
    res.writeHead(302, { Location: target })
    res.end()
    return
  }

  // ── 令牌端点 ──
  if (path === '/token' && req.method === 'POST') {
    const body = await readBody(req)
    const form = new URLSearchParams(body)
    const code = form.get('code') ?? ''
    const entry = codes.get(code)
    if (!entry) {
      sendJson(res, 400, { error: 'invalid_grant' })
      return
    }
    codes.delete(code)
    console.log('[fake] 令牌签发成功')
    sendJson(res, 200, {
      access_token: 'fake-access-token-xyz',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp:connect',
    })
    return
  }

  sendJson(res, 404, { error: 'not found', path })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fake] 模拟 oauth mcp server: ${BASE}/mcp`)
})
