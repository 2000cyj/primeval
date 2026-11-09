/**
 * Minimal MCP server speaking JSON-RPC 2.0 over stdio, implemented by hand
 * (newline-delimited JSON) so the spike needs no network access and no
 * npx-installed package.
 *
 * Protocol shape verified against @modelcontextprotocol/client@2.4.0:
 * - `initialize` -> InitializeResult { protocolVersion, capabilities, serverInfo }
 * - `notifications/initialized` -> no response (notification)
 * - `tools/list` -> { tools: [...] }
 * - `tools/call` -> { content: [{ type: "text", text }] }
 */
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2025-11-25'

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the given message.',
    // Deliberately a raw JSON Schema (not zod-derived) so the proxy spike
    // can check that upstream inputSchema survives a round trip verbatim.
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Text to echo.' },
        count: { type: 'number', minimum: 1 },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
]

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id: unknown, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })

rl.on('line', (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let message: unknown
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }

  if (typeof message !== 'object' || message === null) return
  const { id, method, params } = message as {
    id?: unknown
    method?: unknown
    params?: { name?: unknown; arguments?: unknown }
  }

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'minimal-stdio-server', version: '0.0.1' },
      })
      break

    case 'notifications/initialized':
    case 'initialized':
      // Notification: never answered.
      break

    case 'ping':
      reply(id, {})
      break

    case 'tools/list':
      reply(id, { tools: TOOLS })
      break

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments ?? {}
      if (name !== 'echo') {
        replyError(id, -32602, `Unknown tool: ${String(name)}`)
        break
      }
      reply(id, {
        content: [
          {
            type: 'text',
            text: `echo(${JSON.stringify(args)})`,
          },
        ],
      })
      break
    }

    default:
      if (id !== undefined) {
        replyError(id, -32601, `Method not found: ${String(method)}`)
      }
      break
  }
})
