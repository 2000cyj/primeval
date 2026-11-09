/**
 * Spike: remaining details a proxy needs to know.
 *
 *  A) Does the low-level `Server` VALIDATE the `tools/call` result? (Does an
 *     upstream result with extra fields survive the round trip?)
 *  B) The 3-arg `setRequestHandler(method, schemas, handler)` overload with
 *     spec method names.
 *  C) `createMcpHandler({ legacy: 'reject' })` — what a 2025-era client sees.
 *  D) `handler.notify` / `handler.bus` surface.
 *
 * Run: node --experimental-strip-types spike/spike-details.ts
 */
import { createServer } from 'node:http'
import { McpServer, Server, createMcpHandler, specTypeSchemas } from '@modelcontextprotocol/server'
import { InMemoryTransport, Client } from '@modelcontextprotocol/client'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

async function main(): Promise<void> {
  // ---------- A) tools/call result validation ----------
  console.log('=== A) tools/call result: extra fields preserved? ===')
  const server = new Server({ name: 'detail-server', version: '0.0.1' })
  server.registerCapabilities({ tools: {} })
  server.setRequestHandler('tools/list', async () => ({
    tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
  }))
  server.setRequestHandler('tools/call', async () => ({
    content: [{ type: 'text', text: 'hi' }],
    // Fields a real upstream server might send that are not in the
    // CallToolResult schema:
    structuredContent: { a: 1 },
    _meta: { 'io.modelcontextprotocol/upstream': { x: 1 } },
    isError: false,
  }))
  {
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'detail-client', version: '0.0.1' })
    await Promise.all([server.connect(st), client.connect(ct)])
    const result = await client.callTool({ name: 'echo', arguments: {} })
    console.log('callTool result =', JSON.stringify(result))
    await client.close()
  }

  // ---------- B) 3-arg setRequestHandler ----------
  console.log('\n=== B) 3-arg setRequestHandler ===')
  // B1: with a SPEC method name -> FAILS at runtime. The 3-arg overload is
  // only for custom (non-spec) methods; spec methods must use the 2-arg form.
  const server2 = new Server({ name: 'detail-server-2', version: '0.0.1' })
  server2.registerCapabilities({ tools: {} })
  server2.setRequestHandler(
    'tools/list',
    { params: specTypeSchemas.ListToolsRequest, result: specTypeSchemas.ListToolsResult },
    async () => ({
      tools: [{ name: 'from-3-arg', inputSchema: { type: 'object' as const, properties: {} } }],
    }),
  )
  {
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'detail-client-2', version: '0.0.1' })
    await Promise.all([server2.connect(st), client.connect(ct)])
    try {
      const tools = await client.listTools()
      console.log('  spec method + 3-arg form: listTools =', JSON.stringify(tools))
    } catch (error) {
      console.log('  spec method + 3-arg form FAILED:', (error as Error).message)
    }
    await client.close()
  }

  // B2: with a CUSTOM method name -> works.
  const server2b = new Server({ name: 'detail-server-2b', version: '0.0.1' })
  server2b.setRequestHandler(
    'acme/list',
    { params: specTypeSchemas.EmptyResult, result: specTypeSchemas.EmptyResult },
    async () => ({}),
  )
  {
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'detail-client-2b', version: '0.0.1' })
    await Promise.all([server2b.connect(st), client.connect(ct)])
    const response = await client.request(
      { method: 'acme/list', params: {} },
      specTypeSchemas.EmptyResult,
    )
    console.log('  custom method + 3-arg form: result =', JSON.stringify(response))
    await client.close()
  }

  // ---------- C) legacy: 'reject' ----------
  console.log('\n=== C) createMcpHandler({ legacy: "reject" }) ===')
  const strict = createMcpHandler(
    () => {
      const s = new McpServer({ name: 'strict', version: '0.0.1' })
      s.registerTool('echo', { description: 'Echo.' }, async () => ({
        content: [{ type: 'text', text: 'e' }],
      }))
      return s
    },
    { legacy: 'reject' },
  )
  const httpServer = createServer(async (req, res) => {
    const url = `http://127.0.0.1:7841${req.url ?? '/'}`
    const response = await strict.fetch(toWebRequest(req, url))
    await writeWebResponse(res, response)
  })
  await new Promise<void>((resolve) => httpServer.listen(7841, '127.0.0.1', resolve))
  {
    const response = await fetch('http://127.0.0.1:7841/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
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
    console.log('  2025-era initialize status =', response.status)
    console.log('  body =', (await response.text()).slice(0, 300))
  }
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))

  // ---------- D) handler.notify / handler.bus ----------
  console.log('\n=== D) handler.notify / handler.bus ===')
  const handler = createMcpHandler(() => {
    const s = new McpServer({ name: 'notify-server', version: '0.0.1' })
    s.registerTool('echo', { description: 'Echo.' }, async () => ({
      content: [{ type: 'text', text: 'e' }],
    }))
    return s
  })
  console.log('  typeof handler.fetch   =', typeof handler.fetch)
  console.log('  typeof handler.close   =', typeof handler.close)
  console.log('  typeof handler.notify  =', typeof handler.notify)
  console.log('  typeof handler.bus     =', typeof handler.bus)
  console.log('  notify methods =', Object.keys(handler.notify))
  console.log('  bus methods   =', Object.keys(handler.bus))
  handler.notify.toolsChanged()
  console.log('  notify.toolsChanged() with no open subscription = no-op (no throw)')
  await handler.close()
}

main().catch((error) => {
  console.error('[details] FAILED:', error)
  process.exitCode = 1
})
