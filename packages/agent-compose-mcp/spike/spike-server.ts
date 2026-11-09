/**
 * Spike: mount an MCP server on node:http and probe it with a real
 * @modelcontextprotocol/client@2.4.0 `Client` over Streamable HTTP.
 *
 * Two server wirings are exercised:
 *  A) `createMcpHandler` — the SDK's own HTTP entry (modern 2026-07-28 era
 *     per-request transport + legacy 2025 stateless fallback).
 *  B) `WebStandardStreamableHTTPServerTransport` wired by hand, both
 *     stateless (sessionIdGenerator: undefined) and stateful
 *     (sessionIdGenerator: crypto.randomUUID).
 *
 * Run: node --experimental-strip-types spike/spike-server.ts
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server'
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

/** One fake tool, registered on the high-level McpServer. */
function makeMcpServer(): McpServer {
  const server = new McpServer({ name: 'spike-server', version: '0.0.1' })
  server.registerTool(
    'echo',
    {
      description: 'Echo back the given message.',
      // fromJsonSchema turns a raw JSON Schema into the
      // StandardSchemaWithJSON that registerTool expects.
      inputSchema: fromJsonSchema<{ message: string }>({
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      }),
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: `echo:${message}` }],
    }),
  )
  return server
}

type Wiring = 'handler' | 'stateless' | 'stateful'

async function serve(
  wiring: Wiring,
  port: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

  const httpServer = createServer(async (req, res) => {
    const url = `http://127.0.0.1:${port}${req.url ?? '/'}`

    if (wiring === 'handler') {
      const handler = createMcpHandler(() => makeMcpServer())
      const response = await handler.fetch(toWebRequest(req, url))
      await writeWebResponse(res, response)
      return
    }

    if (wiring === 'stateless') {
      // New server + transport per request, no session id.
      const server = makeMcpServer()
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      await server.connect(transport)
      const response = await transport.handleRequest(toWebRequest(req, url))
      await writeWebResponse(res, response)
      return
    }

    // stateful: one transport per session, keyed by the mcp-session-id header.
    const sessionId = req.headers['mcp-session-id']
    if (typeof sessionId === 'string' && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)
      if (!transport) return
      const response = await transport.handleRequest(toWebRequest(req, url))
      await writeWebResponse(res, response)
      return
    }

    if (req.method === 'POST') {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport)
        },
      })
      const server = makeMcpServer()
      await server.connect(transport)
      const response = await transport.handleRequest(toWebRequest(req, url))
      await writeWebResponse(res, response)
      return
    }

    res.statusCode = 400
    res.end('missing mcp-session-id')
  })

  await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      for (const transport of sessions.values()) await transport.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

/** Raw JSON-RPC POST so we can observe the HTTP status and headers directly. */
async function rawPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

async function probeRaw(url: string): Promise<void> {
  console.log('\n=== raw initialize POST ===')
  const init = await rawPost(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'raw-probe', version: '0.0.1' },
    },
  })
  console.log('status          =', init.status)
  console.log('mcp-session-id  =', init.headers.get('mcp-session-id'))
  console.log('content-type    =', init.headers.get('content-type'))
  console.log('body            =', init.text.slice(0, 400))
}

async function probeWithClient(url: string, label: string): Promise<void> {
  console.log(`\n=== real Client over Streamable HTTP (${label}) ===`)
  const client = new Client({ name: 'spike-http-client', version: '0.0.1' })
  const transport = new StreamableHTTPClientTransport(new URL(url))
  try {
    await client.connect(transport)
    console.log('connect         = OK')
    console.log('sessionId       =', transport.sessionId ?? '(none)')
    const tools = await client.listTools()
    console.log('listTools       =', JSON.stringify(tools))
    const called = await client.callTool({ name: 'echo', arguments: { message: 'hi' } })
    console.log('callTool        =', JSON.stringify(called))
  } catch (error) {
    console.log('connect/call FAILED:', (error as Error).message)
  } finally {
    await client.close().catch(() => {})
  }
}

async function main(): Promise<void> {
  const wirings: Wiring[] = ['handler', 'stateless', 'stateful']
  // Ports 17801+ : the real proxy app is expected on 7801, so the spike
  // stays out of its way.
  let port = 17801

  for (const wiring of wirings) {
    const { url, close } = await serve(wiring, port)
    console.log(`\n########## wiring=${wiring} url=${url} ##########`)
    await probeRaw(url)
    await probeWithClient(url, wiring)
    await close()
    port += 1
  }
}

main().catch((error) => {
  console.error('[spike] FAILED:', error)
  process.exitCode = 1
})
