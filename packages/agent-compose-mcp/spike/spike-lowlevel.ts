/**
 * Spike: low-level `Server` (not `McpServer`) — register `tools/list` and
 * `tools/call` handlers and return an upstream JSON Schema `inputSchema`
 * verbatim, with no zod conversion.
 *
 * Also checks the 3-argument `setRequestHandler(method, schemas, handler)`
 * overload for a custom method, and confirms `McpServer.registerTool` exists.
 *
 * Run: node --experimental-strip-types spike/spike-lowlevel.ts
 */
import { Server, McpServer, specTypeSchemas, type JSONValue } from '@modelcontextprotocol/server'
import { InMemoryTransport, Client } from '@modelcontextprotocol/client'

// The exact JSON Schema an upstream server would send us. It contains keys
// that a zod-derived schema would not produce (additionalProperties, minimum,
// nested oneOf), so we can see whether they survive verbatim.
// A raw JSON Schema exactly as an upstream server would send it. The SDK's
// `Tool['inputSchema']` type is narrow: `type` must be the literal "object"
// and `properties` must be a JSONValue map, so the literal is annotated.
const UPSTREAM_INPUT_SCHEMA: {
  type: 'object'
  properties: { [key: string]: JSONValue }
  required: string[]
  additionalProperties: boolean
  $schema: string
} = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Text to echo.' },
    count: { type: 'number', minimum: 1 },
    nested: {
      oneOf: [{ type: 'string' }, { type: 'number' }],
    },
  },
  required: ['message'],
  additionalProperties: false,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
}

async function main(): Promise<void> {
  // ---------- low-level Server ----------
  const server = new Server({ name: 'lowlevel-server', version: '0.0.1' })

  // PITFALL: the low-level Server refuses to register a spec handler unless
  // the matching capability was declared first (registerCapabilities must be
  // called BEFORE connect(), and before setRequestHandler for that family).
  server.registerCapabilities({ tools: {} })

  // v2 API: spec methods are registered by METHOD NAME, not by zod schema.
  // (v1's `setRequestHandler(ListToolsRequestSchema, handler)` no longer exists.)
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo back the given message.',
        inputSchema: UPSTREAM_INPUT_SCHEMA,
      },
    ],
  }))

  server.setRequestHandler('tools/call', async (request) => {
    const params = request.params as { name?: string; arguments?: Record<string, unknown> }
    return {
      content: [{ type: 'text', text: `echo:${JSON.stringify(params.arguments ?? {})}` }],
    }
  })

  // 3-arg overload: custom (non-spec) method with explicit param/result schemas.
  server.setRequestHandler(
    'acme/ping',
    {
      params: specTypeSchemas.EmptyResult,
      result: specTypeSchemas.EmptyResult,
    },
    async () => ({}),
  )

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'lowlevel-client', version: '0.0.1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const tools = await client.listTools()
  console.log('[lowlevel] listTools =', JSON.stringify(tools, null, 2))

  // Is the upstream JSON Schema byte-identical after the round trip?
  const roundTripped = tools.tools[0]?.inputSchema as Record<string, unknown>
  console.log(
    '[lowlevel] inputSchema deep-equal to upstream =',
    JSON.stringify(roundTripped) === JSON.stringify(UPSTREAM_INPUT_SCHEMA),
  )
  console.log('[lowlevel] inputSchema keys =', Object.keys(roundTripped ?? {}))
  console.log('[lowlevel] $schema preserved =', roundTripped?.$schema)

  const called = await client.callTool({ name: 'echo', arguments: { message: 'hi' } })
  console.log('[lowlevel] callTool  =', JSON.stringify(called))

  // ---------- high-level McpServer.registerTool still exists ----------
  const high = new McpServer({ name: 'highlevel-server', version: '0.0.1' })
  console.log(
    '[lowlevel] McpServer.registerTool is a function =',
    typeof high.registerTool === 'function',
  )
  console.log(
    '[lowlevel] McpServer.toolInputSchemaJson is a function =',
    typeof high.toolInputSchemaJson === 'function',
  )

  await client.close()
}

main().catch((error) => {
  console.error('[lowlevel] FAILED:', error)
  process.exitCode = 1
})
