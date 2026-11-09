/**
 * Spike: the CLIENT side of the proxy — connecting to an upstream MCP server.
 *
 *  A) stdio upstream: `Client` + `StdioClientTransport` (already proven in
 *     spike-client.ts; re-run here with an HTTP upstream for symmetry).
 *  B) Streamable HTTP upstream: `Client` + `StreamableHTTPClientTransport`
 *     against a stateful server — does the client carry the session id?
 *  C) The same client against a STATELESS upstream — does it work without a
 *     session id?
 *
 * Run: node --experimental-strip-types spike/spike-upstream-client.ts
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

function makeMcpServer(): McpServer {
  const server = new McpServer({ name: 'upstream', version: '0.0.1' })
  server.registerTool(
    'upstream_tool',
    { description: 'A tool living on the upstream server.' },
    async () => ({ content: [{ type: 'text', text: 'from upstream' }] }),
  )
  return server
}

async function startUpstream(
  port: number,
  stateful: boolean,
): Promise<{ url: string; close: () => Promise<void> }> {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const httpServer = createServer(async (req, res) => {
    const url = `http://127.0.0.1:${port}/mcp`
    const sessionId = req.headers['mcp-session-id']

    if (stateful && typeof sessionId === 'string' && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)
      if (!transport) return
      const response = await transport.handleRequest(toWebRequest(req, url))
      await writeWebResponse(res, response)
      return
    }

    const transport: WebStandardStreamableHTTPServerTransport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: stateful ? () => randomUUID() : undefined,
        onsessioninitialized: stateful
          ? (id: string): void => {
              sessions.set(id, transport)
            }
          : undefined,
      })
    await makeMcpServer().connect(transport)
    const response = await transport.handleRequest(toWebRequest(req, url))
    await writeWebResponse(res, response)
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

async function probe(url: string, label: string): Promise<void> {
  console.log(`\n=== client -> ${label} (${url}) ===`)
  const client = new Client({ name: 'proxy-side-client', version: '0.0.1' })
  const transport = new StreamableHTTPClientTransport(new URL(url))
  try {
    await client.connect(transport)
    console.log('connect OK')
    console.log('transport.sessionId =', transport.sessionId ?? '(none)')
    console.log('client.getServerVersion() =', JSON.stringify(client.getServerVersion()))
    const tools = await client.listTools()
    console.log('listTools =', JSON.stringify(tools))
    const called = await client.callTool({ name: 'upstream_tool', arguments: {} })
    console.log('callTool  =', JSON.stringify(called))
  } catch (error) {
    console.log('FAILED:', (error as Error).message)
  } finally {
    await client.close().catch(() => {})
  }
}

async function main(): Promise<void> {
  const stateful = await startUpstream(7821, true)
  await probe(stateful.url, 'stateful upstream')
  await stateful.close()

  const stateless = await startUpstream(7822, false)
  await probe(stateless.url, 'stateless upstream')
  await stateless.close()
}

main().catch((error) => {
  console.error('[upstream] FAILED:', error)
  process.exitCode = 1
})
