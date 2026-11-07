#!/usr/bin/env node
/**
 * Fetch the Figma design data for a file/node straight from the Figma REST API.
 *
 * It reuses the token lookup of scripts/figma-mcp.mjs (env -> Windows registry
 * -> <repo>/.env) and prints the JSON payload of GET /v1/files/<key>/nodes.
 *
 *   node scripts/figma-fetch.mjs <fileKey> [nodeId]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [fileKey, nodeId = '0:1'] = process.argv.slice(2)

if (!fileKey) {
  console.error('usage: node scripts/figma-fetch.mjs <fileKey> [nodeId]')
  process.exit(1)
}

const TOKEN_ENV_NAMES = [
  'FIGMA_TOKEN',
  'FIGMA_API_KEY',
  'FIGMA_ACCESS_TOKEN',
  'FIGMA_PERSONAL_ACCESS_TOKEN',
]
const REGISTRY_ENV_KEYS = [
  ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'],
  ['HKCU\\Environment'],
]

function readRegistryValue(hive, name) {
  try {
    const out = execFileSync('reg', ['query', hive, '/v', name], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = out.match(new RegExp(`${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.*)`))
    return match ? match[1].trim() : ''
  } catch {
    return ''
  }
}

function placeholderTarget(value) {
  const match = value.match(/^%([^%]+)%$/)
  return match ? match[1] : ''
}

function lookup(name, depth = 0) {
  const live = process.env[name]?.trim()
  if (live && !placeholderTarget(live)) return live
  if (depth > 2) return ''
  for (const [hive] of REGISTRY_ENV_KEYS) {
    const value = readRegistryValue(hive, name)
    if (!value) continue
    const target = placeholderTarget(value)
    if (target) {
      const resolved = lookup(target, depth + 1)
      if (resolved) return resolved
      continue
    }
    return value
  }
  return ''
}

function readEnvFile() {
  const envFile = join(repoRoot, '.env')
  if (!existsSync(envFile)) return ''
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const name = match[1]
    const value = match[2].replace(/^["']|["']$/g, '')
    if (!value) continue
    if (TOKEN_ENV_NAMES.includes(name) || /figma/i.test(name)) {
      if (!/oauth/i.test(name)) return value
    }
  }
  return ''
}

function resolveToken() {
  for (const name of TOKEN_ENV_NAMES) {
    const value = lookup(name)
    if (value) return value
  }
  for (const name of Object.keys(process.env)) {
    if (!/figma/i.test(name) || /oauth/i.test(name)) continue
    const value = lookup(name)
    if (value) return value
  }
  return readEnvFile()
}

const token = resolveToken()
if (!token) {
  console.error('[figma-fetch] no Figma token found (env / registry / .env).')
  process.exit(1)
}

const url = new URL(`https://api.figma.com/v1/files/${fileKey}/nodes`)
url.searchParams.set('ids', nodeId)

const res = await fetch(url, { headers: { 'X-Figma-Token': token } })
const body = await res.text()
if (!res.ok) {
  console.error(`[figma-fetch] HTTP ${res.status}: ${body.slice(0, 500)}`)
  process.exit(1)
}
process.stdout.write(body)
