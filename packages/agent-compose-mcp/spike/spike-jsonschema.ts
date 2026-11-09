/**
 * Spike: `fromJsonSchema` — turning a raw JSON Schema into a
 * `StandardSchemaWithJSON` so the HIGH-LEVEL `McpServer.registerTool` can
 * advertise an upstream JSON Schema without a zod round trip.
 *
 * Also checks the stateful transport's session-id mismatch behaviour (404).
 *
 * Run: node --experimental-strip-types spike/spike-jsonschema.ts
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  fromJsonSchema,
} from '@modelcontextprotocol/server'
import { InMemoryTransport, Client } from '@modelcontextprotocol/client'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

const UPSTREAM_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Text to echo.' },
    count: { type: 'number', minimum: 1 },
  },
  required: ['message'],
  additionalProperties: false,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
}

async function main(): Promise<void> {
  // ---------- fromJsonSchema + McpServer.registerTool ----------
  console.log('=== fromJsonSchema + McpServer.registerTool ===')
  const server = new McpServer({ name: 'from-json-schema', version: '0.0.1' })

  // fromJsonSchema(schema, validator?) -> StandardSchemaWithJSON<T, T>
  // The generic argument is what types the tool callback's args parameter.
  const standard = fromJsonSchema<{ message: string }>(UPSTREAM_INPUT_SCHEMA)
  console.log('has ~standard =', typeof (standard as { '~standard'?: unknown })['~standard'])

  server.registerTool(
    'echo',
    {
      description: 'Echo back the given message.',
      inputSchema: standard,
    },
    async ({ message }) => ({ content: [{ type: 'text', text: `echo:${message}` }] }),
  )

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'fjs-client', version: '0.0.1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const tools = await client.listTools()
  console.log('listTools =', JSON.stringify(tools, null, 2))
  const roundTripped = tools.tools[0]?.inputSchema as Record<string, unknown>
  console.log(
    'inputSchema deep-equal to upstream =',
    JSON.stringify(roundTripped) === JSON.stringify(UPSTREAM_INPUT_SCHEMA),
  )
  console.log('inputSchema keys =', Object.keys(roundTripped ?? {}))

  await client.close()

  // ---------- stateful transport: session id mismatch ----------
  console.log('\n=== stateful transport: session id mismatch ===')
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await makeMcpServer().connect(transport)

  const httpServer = createServer(async (req, res) => {
    const url = `http://127.0.0.1:7814${req.url ?? '/'}`
    const response = await transport.handleRequest(toWebRequest(req, url))
    await writeWebResponse(res, response)
  })
  await new Promise<void>((resolve) => httpServer.listen(7814, '127.0.0.1', resolve))

  const init = await fetch('http://127.0.0.1:7814/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
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
  const realSession = init.headers.get('mcp-session-id')
  console.log('initialize status =', init.status, '| session =', realSession)
  await init.text()

  const mismatch = await fetch('http://127.0.0.1:7814/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': 'a-different-session',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  })
  console.log('mismatched session status =', mismatch.status)
  console.log('body =', (await mismatch.text()).slice(0, 250))

  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
}

function makeMcpServer(): McpServer {
  const server = new McpServer({ name: 'sess', version: '0.0.1' })
  server.registerTool('echo', { description: 'Echo.' }, async () => ({
    content: [{ type: 'text', text: 'echo' }],
  }))
  return server
}

main().catch((error) => {
  console.error('[fjs] FAILED:', error)
  process.exitCode = 1
})
