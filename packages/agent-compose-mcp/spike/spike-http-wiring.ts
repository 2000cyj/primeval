/**
 * Spike: how the auth gate and the body limit actually attach to
 * `createMcpHandler` on a node:http server.
 *
 *  - `requireBearerAuth` gate in front of `handler.fetch(request, { authInfo })`
 *  - the factory receives `ctx.authInfo` (per-request context)
 *  - `readRequestBody` with a REAL content-length (over the node:http server)
 *  - `createMcpHandler({ maxRequestBodySize })` -> 413
 *
 * Run: node --experimental-strip-types spike/spike-http-wiring.ts
 */
import { createServer } from 'node:http'
import {
  OAuthError,
  OAuthErrorCode,
  McpServer,
  createMcpHandler,
  readRequestBody,
  requireBearerAuth,
} from '@modelcontextprotocol/server'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

const TOKEN = 'good-token'

const verifier = {
  async verifyAccessToken(token: string) {
    if (token !== TOKEN) throw new OAuthError(OAuthErrorCode.InvalidToken, 'unknown token')
    return {
      token,
      clientId: 'client-1',
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }
  },
}

async function main(): Promise<void> {
  const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] })

  const handler = createMcpHandler(
    (ctx) => {
      const server = new McpServer({ name: 'wired', version: '0.0.1' })
      server.registerTool(
        'whoami',
        { description: 'Report the authenticated client.' },
        async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                clientId: ctx.authInfo?.clientId ?? null,
                scopes: ctx.authInfo?.scopes ?? [],
                era: ctx.era,
              }),
            },
          ],
        }),
      )
      return server
    },
    { maxRequestBodySize: 1024 },
  )

  const httpServer = createServer(async (req, res) => {
    const url = `http://127.0.0.1:7815${req.url ?? '/'}`
    const request = toWebRequest(req, url)

    // readRequestBody against the real request (real content-length present)
    const body = await readRequestBody(request.clone(), 1024)
    console.log('  readRequestBody =', JSON.stringify(body).slice(0, 120))

    const auth = await gate(request)
    if (auth instanceof Response) {
      await writeWebResponse(res, auth)
      return
    }

    const response = await handler.fetch(request, { authInfo: auth })
    await writeWebResponse(res, response)
  })
  await new Promise<void>((resolve) => httpServer.listen(7815, '127.0.0.1', resolve))

  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'x', version: '1' },
    },
  })

  // no auth header
  const noAuth = await fetch('http://127.0.0.1:7815/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: initBody,
  })
  console.log(
    'no-auth status =',
    noAuth.status,
    '| www-authenticate =',
    noAuth.headers.get('www-authenticate'),
  )
  await noAuth.text()

  // with auth header
  const withAuth = await fetch('http://127.0.0.1:7815/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    },
    body: initBody,
  })
  console.log('with-auth status =', withAuth.status)
  await withAuth.text()

  // oversized body -> 413
  const big = await fetch('http://127.0.0.1:7815/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'y'.repeat(5000) } }),
  })
  console.log('oversized status =', big.status)
  console.log('oversized body =', (await big.text()).slice(0, 200))

  // authInfo reaches the tool handler through the factory context
  const whoami = await fetch('http://127.0.0.1:7815/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    }),
  })
  console.log('whoami body =', (await whoami.text()).slice(0, 400))

  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
}

main().catch((error) => {
  console.error('[wiring] FAILED:', error)
  process.exitCode = 1
})
