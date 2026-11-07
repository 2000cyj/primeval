#!/usr/bin/env node
/**
 * One-shot setup for the Figma MCP server.
 *
 *   node scripts/setup-figma-mcp.mjs
 *   node scripts/setup-figma-mcp.mjs --install
 *
 * It merges a "figma" entry into .mcp.json (keeping the servers already
 * configured there) and points it at scripts/figma-mcp.mjs, the launcher that
 * feeds the Figma Personal Access Token from the environment to the server.
 *
 * When figma-developer-mcp is not installed in this repo but exists somewhere
 * else on the machine, the setup writes scripts/.figma-mcp.local.json (local,
 * gitignored) so the launcher can use that copy until `pnpm install` has run.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mcpConfigPath = join(repoRoot, '.mcp.json')
const localConfigPath = join(repoRoot, 'scripts', '.figma-mcp.local.json')
const localPackageDir = join(repoRoot, 'node_modules', 'figma-developer-mcp')

if (process.argv.includes('--install')) {
  console.log('[figma-mcp] running pnpm install ...')
  const install = spawnSync('pnpm', ['install'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (install.status !== 0) {
    console.error('[figma-mcp] pnpm install failed - fix that first.')
    process.exit(install.status ?? 1)
  }
}

// --- merge the "figma" entry into .mcp.json ---------------------------------
let config = { mcpServers: {} }
if (existsSync(mcpConfigPath)) {
  const raw = readFileSync(mcpConfigPath, 'utf8')
  try {
    config = JSON.parse(raw)
  } catch {
    console.error('[figma-mcp] .mcp.json is not valid JSON - fix it by hand.')
    process.exit(1)
  }
}

config.mcpServers ??= {}
const existed = Boolean(config.mcpServers.figma)
config.mcpServers.figma = {
  command: 'node',
  args: ['scripts/figma-mcp.mjs', '--stdio', '--no-telemetry', '--image-dir', '.claude'],
}

writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`)
if (existed) {
  console.log('[figma-mcp] updated the figma entry in .mcp.json')
} else {
  console.log('[figma-mcp] added the figma entry to .mcp.json')
}

// --- make sure the package can be found ------------------------------------
function findInstalledCopy() {
  if (existsSync(join(localPackageDir, 'dist', 'bin.js'))) {
    return localPackageDir
  }
  // 最常用的位置放在后面:栈是后进先出,workspaces 会先被扫
  const roots = ['C:/Users/20614/orca', 'C:/Users/20614/orca/workspaces']
  const seen = new Set()
  const stack = roots.map((dir) => ({ dir, depth: 0 }))
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()
    if (seen.has(dir)) continue
    seen.add(dir)
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      const candidate = join(
        full,
        'node_modules/.pnpm/figma-developer-mcp@0.13.2',
        'node_modules/figma-developer-mcp',
      )
      if (existsSync(join(candidate, 'dist', 'bin.js'))) {
        return candidate
      }
      if (depth < 4) {
        stack.push({ dir: full, depth: depth + 1 })
      }
    }
  }
  return null
}

const packageDir = findInstalledCopy()
if (!packageDir) {
  console.log('[figma-mcp] figma-developer-mcp missing - run pnpm install.')
} else if (packageDir === localPackageDir) {
  console.log('[figma-mcp] figma-developer-mcp is installed locally.')
} else {
  writeFileSync(localConfigPath, `${JSON.stringify({ packageDir }, null, 2)}\n`)
  console.log('[figma-mcp] using an existing install elsewhere on this machine.')
  console.log('[figma-mcp] run `pnpm install` later to make it repo-local.')
}

// --- report on the token ----------------------------------------------------
const token = process.env.FIGMA_TOKEN || process.env.FIGMA_API_KEY
if (!token) {
  console.log('[figma-mcp] FIGMA_TOKEN is not set in this shell.')
} else {
  console.log('[figma-mcp] a Figma token was found in the environment.')
}

console.log('[figma-mcp] done - restart Claude Code to load the server.')
