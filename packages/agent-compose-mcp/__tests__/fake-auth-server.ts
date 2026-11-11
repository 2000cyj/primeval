/**
 * 一个假的「远程 MCP server + 授权服务器」，用来验证 OAuth 的两条分支：
 *
 * 1. `no-registration`：授权服务器没有 registration_endpoint
 *    → 允许本地自选 client_id（降级路径），应给出授权地址
 * 2. `reject-registration`：声明了 registration_endpoint 但拒绝注册
 *    → 不能降级，应明确报错让用户改用固定令牌
 * 3. `registration-ok`：声明了 registration_endpoint 且注册成功
 *    → 标准动态注册流程，应走通
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const MODE = process.env.MODE ?? 'no-registration'
const PORT = Number(process.env.PORT ?? 9920)
const ISSUER = `http://127.0.0.1:${PORT}`

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', ISSUER)

  // 授权服务器元数据
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    const body: Record<string, unknown> = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      grant_types_supported: ['authorization_code'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:connect'],
    }
    // 模式 2/3：声明了注册端点
    if (MODE === 'reject-registration' || MODE === 'registration-ok') {
      body['registration_endpoint'] = `${ISSUER}/register`
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }

  // 动态注册端点：
  // - registration-ok：注册成功，返回 client_id / client_secret
  // - reject-registration：一律拒绝
  if (url.pathname === '/register') {
    if (MODE === 'registration-ok') {
      const body = {
        client_id: `registered-${randomBytes(6).toString('base64url')}`,
        client_secret: randomBytes(16).toString('base64url'),
        redirect_uris: [`${ISSUER}/callback`],
      }
      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'forbidden' }))
    return
  }

  // 授权端点：校验 client_id 存不存在（模拟 figma 的行为）
  if (url.pathname === '/authorize') {
    const clientId = url.searchParams.get('client_id')
    console.log(`[auth] authorize client_id=${clientId}`)
    if (MODE === 'reject-registration' && clientId?.startsWith('agent-compose-')) {
      // 模拟 figma：这个 client_id 没注册过
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `OAuth app with client id ${clientId} doesn't exist` }))
      return
    }
    // 模式 3：只认注册出来的 client_id
    if (MODE === 'registration-ok' && !clientId?.startsWith('registered-')) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `OAuth app with client id ${clientId} doesn't exist` }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // token 端点
  if (url.pathname === '/token') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        access_token: 'fake-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    )
    return
  }

  // MCP 端点：未授权时回 401 + 挑战头（这是 oauth 流程的入口）
  if (url.pathname === '/mcp') {
    const auth = req.headers.authorization
    if (!auth) {
      res.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource",scope="mcp:connect"`,
      })
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '1.0.0' },
        },
      }),
    )
    return
  }

  // 资源服务器元数据
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        resource: `${ISSUER}/mcp`,
        authorization_servers: [ISSUER],
        scopes_supported: ['mcp:connect'],
      }),
    )
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[auth] listening on ${PORT}, mode=${MODE}`)
})
