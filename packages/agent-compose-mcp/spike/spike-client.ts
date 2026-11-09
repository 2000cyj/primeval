/**
 * Spike: connect a real @modelcontextprotocol/client@2.4.0 `Client` to the
 * hand-written stdio MCP server in `minimal-stdio-server.ts` and exercise the
 * real method names / parameter shapes.
 *
 * Run: node --experimental-strip-types spike/spike-client.ts
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const here = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', resolve(here, 'minimal-stdio-server.ts')],
    stderr: 'inherit',
  })

  const client = new Client({ name: 'spike-client', version: '0.0.1' })

  // connect(transport) performs the 2025 initialize handshake by default
  // (ClientOptions.versionNegotiation defaults to mode 'legacy').
  await client.connect(transport)

  console.log('[spike] serverVersion  =', JSON.stringify(client.getServerVersion()))
  console.log('[spike] serverCaps     =', JSON.stringify(client.getServerCapabilities()))

  // Real method name: listTools(params?, options?) -> Promise<ListToolsResult>
  const listResult = await client.listTools()
  console.log('[spike] listTools keys =', Object.keys(listResult))
  console.log('[spike] listTools      =', JSON.stringify(listResult, null, 2))

  // Real method name: callTool(params, options?) -> Promise<CallToolResult>
  // params shape: { name: string, arguments?: Record<string, unknown> }
  const callResult = await client.callTool({
    name: 'echo',
    arguments: { message: 'hello', count: 2 },
  })
  console.log('[spike] callTool       =', JSON.stringify(callResult, null, 2))

  await client.close()
}

main().catch((error) => {
  console.error('[spike] FAILED:', error)
  process.exitCode = 1
})
