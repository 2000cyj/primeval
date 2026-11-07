#!/usr/bin/env node
/**
 * Figma MCP launcher for Claude Code.
 *
 * Runs Framelink's figma-developer-mcp (local stdio server) and hands it the
 * Figma Personal Access Token taken from the environment. The server only
 * understands FIGMA_API_KEY and exits at startup when it has none, so the
 * token is looked up in four places:
 *
 *   1. the current process environment
 *   2. the Windows registry (machine scope, then user scope) - a host that was
 *      already running before the variable was created keeps its old
 *      environment snapshot, the registry still has the new value
 *   3. a .env file next to this script
 *
 * A registry value may be an unexpanded placeholder ("%FIGUREMA_TOKEN%");
 * those are resolved one more level instead of being passed through.
 *
 * The token is only ever passed to the child process as FIGMA_API_KEY; it
 * never lands in a committed config file.
 *
 * Package resolution order:
 *   1. FIGMA_MCP_PACKAGE_DIR        (env override)
 *   2. <repo>/node_modules/figma-developer-mcp (normal `pnpm install` path)
 *   3. scripts/.figma-mcp.local.json (gitignored fallback to another install)
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

// Names the token may be stored under, in priority order.
const TOKEN_ENV_NAMES = [
  'FIGMA_TOKEN',
  'FIGMA_API_KEY',
  'FIGMA_ACCESS_TOKEN',
  'FIGMA_PERSONAL_ACCESS_TOKEN',
]

// Windows keeps system/user environment variables in the registry, but a
// running process only sees the snapshot it inherited at start-up.
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

// A value like "%FIGUREMA_TOKEN%" is a reference to another variable, not a
// token. Return the referenced name so the caller can resolve it.
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
  // 兜底:扫描所有 FIGMA* 环境变量,避免变量名与预期不一致
  for (const name of Object.keys(process.env)) {
    if (!/figma/i.test(name) || /oauth/i.test(name)) continue
    const value = lookup(name)
    if (value) return value
  }
  return readEnvFile()
}

const token = resolveToken()
if (!token) {
  console.error('[figma-mcp] no Figma token found (env / registry / .env).')
} else {
  console.error('[figma-mcp] token found, launching figma-developer-mcp.')
}

function resolvePackageDir() {
  if (process.env.FIGMA_MCP_PACKAGE_DIR) {
    return process.env.FIGMA_MCP_PACKAGE_DIR
  }
  const local = join(repoRoot, 'node_modules', 'figma-developer-mcp')
  if (existsSync(join(local, 'dist', 'bin.js'))) {
    return local
  }
  const localConfig = join(repoRoot, 'scripts', '.figma-mcp.local.json')
  if (existsSync(localConfig)) {
    try {
      const { packageDir } = JSON.parse(readFileSync(localConfig, 'utf8'))
      if (packageDir) return packageDir
    } catch {
      console.error('[figma-mcp] scripts/.figma-mcp.local.json is invalid.')
    }
  }
  return local
}

const bin = join(resolvePackageDir(), 'dist', 'bin.js')
if (!existsSync(bin)) {
  console.error('[figma-mcp] figma-developer-mcp missing - run pnpm install.')
  process.exit(1)
}

// The server writes downloaded assets into --image-dir; make sure it exists.
const imageDirIndex = args.indexOf('--image-dir')
if (imageDirIndex !== -1 && args[imageDirIndex + 1]) {
  mkdirSync(args[imageDirIndex + 1], { recursive: true })
}

const child = spawn(process.execPath, [bin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, FIGMA_API_KEY: token },
})

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
