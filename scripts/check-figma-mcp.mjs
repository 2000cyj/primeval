#!/usr/bin/env node
/**
 * Smoke-test the Figma MCP server: performs a stdio handshake and lists the
 * tools it exposes.
 *
 *   node scripts/check-figma-mcp.mjs
 *
 * Exits 0 when tools/list answers, 1 otherwise.
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const launcher = join(repoRoot, 'scripts', 'figma-mcp.mjs')

const child = spawn(process.execPath, [launcher, '--stdio'], {
  stdio: ['pipe', 'pipe', 'inherit'],
})

const tools = new Set()
let buffer = ''

function send(msg) {
  child.stdin.write(`${JSON.stringify(msg)}\n`)
}

function finish(ok) {
  if (tools.size > 0) {
    const names = [...tools].join(', ')
    console.log(`[check] ${tools.size} tools: ${names}`)
  }
  child.kill()
  process.exit(ok ? 0 : 1)
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index = buffer.indexOf('\n')
  while (index !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id === 1 && msg.result) {
      const info = msg.result.serverInfo ?? {}
      console.log(`[check] initialize ok: ${info.name} ${info.version}`)
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    } else if (msg.id === 2 && msg.result) {
      for (const tool of msg.result.tools ?? []) {
        tools.add(tool.name)
      }
      finish(tools.size > 0)
    }
  }
})

setTimeout(() => {
  console.log('[check] timed out waiting for tools/list')
  finish(false)
}, 20000)

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'check-figma-mcp', version: '1.0.0' },
  },
})
