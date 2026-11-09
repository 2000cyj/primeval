/**
 * Spike: the transport-level building blocks and the modern (2026-07-28) era.
 *
 *  A) `PerRequestHTTPServerTransport` used directly (the "power user" wiring).
 *  B) `WebStandardStreamableHTTPServerTransport` in stateful mode — what
 *     happens when a request arrives WITHOUT a valid session id.
 *  C) A modern-era client (`versionNegotiation: { mode: 'auto' }`) against
 *     `createMcpHandler`, to see the 2026-07-28 per-request envelope in action.
 *
 * Run: node --experimental-strip-types spike/spike-transports.ts
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  McpServer,
  PerRequestHTTPServerTransport,
  WebStandardStreamableHTTPServerTransport,
  classifyInboundRequest,
  createMcpHandler,
  isLegacyRequest,
} from '@modelcontextprotocol/server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

function makeMcpServer(): McpServer {
  const server = new McpServer({ name: 'spike-transports', version: '0.0.1' })
  server.registerTool('echo', { description: 'Echo back the given message.' }, async () => ({
    content: [{ type: 'text', text: 'echo' }],
  }))
  return server
}

async function main(): Promise<void> {
  // ---------- A) PerRequestHTTPServerTransport, hand-wired ----------
  console.log('=== A) PerRequestHTTPServerTransport (hand-wired) ===')
  const serverA = createServer(async (req, res) => {
    const url = `http://127.0.0.1:7811${req.url ?? '/'}`
    const request = toWebRequest(req, url)

    const text = await request.clone().text()
    const body = text ? JSON.parse(text) : undefined

    const classification = classifyInboundRequest({
      httpMethod: req.method ?? 'GET',
      protocolVersionHeader: req.headers['mcp-protocol-version'] as string | undefined,
      body,
    })
    console.log('  classification =', JSON.stringify(classification).slice(0, 200))

    if (classification.kind === 'reject') {
      res.statusCode = classification.httpStatus
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: classification.code, message: classification.message },
        }),
      )
      return
    }

    const transport = new PerRequestHTTPServerTransport({
      // MessageClassification = { era: 'legacy' | 'modern', revision?: string }
      classification:
        classification.kind === 'modern'
          ? classification.classification
          : { era: 'legacy', revision: classification.requestedVersion },
      responseMode: 'auto',
    })
    const mcp = makeMcpServer()
    await mcp.connect(transport)
    const response = await transport.handleMessage(body, { request })
    await writeWebResponse(res, response)
  })
  await new Promise<void>((resolve) => serverA.listen(7811, '127.0.0.1', resolve))
  {
    const response = await fetch('http://127.0.0.1:7811/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'x', version: '1' },
        },
      }),
    })
    console.log('  raw initialize status =', response.status)
    console.log('  body =', (await response.text()).slice(0, 200))
  }
  await new Promise<void>((resolve) => serverA.close(() => resolve()))

  // ---------- B) stateful transport: request without a session id ----------
  console.log('\n=== B) stateful transport: request without a valid session id ===')
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const serverB = createServer(async (req, res) => {
    const url = `http://127.0.0.1:7812${req.url ?? '/'}`
    const sessionId = req.headers['mcp-session-id']
    if (typeof sessionId === 'string' && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)
      if (!transport) return
      const response = await transport.handleRequest(toWebRequest(req, url))
      await writeWebResponse(res, response)
      return
    }
    const transport: WebStandardStreamableHTTPServerTransport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string): void => {
          sessions.set(id, transport)
        },
      })
    await makeMcpServer().connect(transport)
    const response = await transport.handleRequest(toWebRequest(req, url))
    await writeWebResponse(res, response)
  })
  await new Promise<void>((resolve) => serverB.listen(7812, '127.0.0.1', resolve))
  {
    // tools/list without any session id
    const response = await fetch('http://127.0.0.1:7812/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    console.log('  tools/list w/o session status =', response.status)
    console.log('  body =', (await response.text()).slice(0, 250))

    // tools/list with a bogus session id
    const bogus = await fetch('http://127.0.0.1:7812/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'not-a-real-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    })
    console.log('  tools/list bogus session status =', bogus.status)
    console.log('  body =', (await bogus.text()).slice(0, 250))

    // GET without a session id
    const getResponse = await fetch('http://127.0.0.1:7812/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    })
    console.log('  GET w/o session status =', getResponse.status)
    await getResponse.text()
  }
  await new Promise<void>((resolve) => serverB.close(() => resolve()))

  // ---------- C) modern-era client against createMcpHandler ----------
  console.log('\n=== C) modern-era client (versionNegotiation mode: auto) ===')
  const handler = createMcpHandler(() => makeMcpServer())
  const serverC = createServer(async (req, res) => {
    const url = `http://127.0.0.1:7813${req.url ?? '/'}`
    const request = toWebRequest(req, url)
    console.log('  isLegacyRequest =', await isLegacyRequest(request))
    const response = await handler.fetch(request)
    await writeWebResponse(res, response)
  })
  await new Promise<void>((resolve) => serverC.listen(7813, '127.0.0.1', resolve))
  {
    const client = new Client(
      { name: 'modern-client', version: '0.0.1' },
      { versionNegotiation: { mode: 'auto' } },
    )
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7813/mcp'))
    try {
      await client.connect(transport)
      console.log('  connect OK; sessionId =', transport.sessionId ?? '(none)')
      const tools = await client.listTools()
      console.log('  listTools =', JSON.stringify(tools))
    } catch (error) {
      console.log('  connect FAILED:', (error as Error).message)
    } finally {
      await client.close().catch(() => {})
    }
  }
  await new Promise<void>((resolve) => serverC.close(() => resolve()))
}

main().catch((error) => {
  console.error('[transports] FAILED:', error)
  process.exitCode = 1
})
