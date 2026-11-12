#!/usr/bin/env node
/**
 * 构建 MCP sidecar（`agent-compose-mcp`）—— 编译成单文件可执行文件。
 *
 * 为什么要单独一个脚本：
 * - sidecar 是 `packages/agent-compose-mcp` 这个独立 package，编译方式
 *   （`bun build --compile`）跟 Rust 的 CLI 完全不同；
 * - 产物必须落在 `apps/AgentCompose/src-tauri/bin/` —— Tauri 打包时
 *   把它当 resource 带进安装包。
 *
 * 开发期**不需要**这个脚本：桌面端和 CLI 都会优先用 Node 直接跑仓库里的
 * TypeScript 源码（改完源码立刻生效，不用重新编译）。
 * 只有打发布包时才需要 —— 安装到用户机器上时没有仓库、也不该依赖 Node。
 *
 * 用法：node scripts/build-sidecar.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
// packageRoot = apps/AgentCompose/ → 上两级是仓库根
const repoRoot = join(packageRoot, '..', '..')
const sidecarDir = join(repoRoot, 'packages', 'agent-compose-mcp')
const entry = join(sidecarDir, 'src', 'index.ts')
const binDir = join(packageRoot, 'src-tauri', 'bin')
const outFile = join(
  binDir,
  process.platform === 'win32' ? 'agent-compose-mcp.exe' : 'agent-compose-mcp',
)

/** 找 bun。PATH 上没有就翻几个常见安装位置。 */
function findBun() {
  const candidates = []
  const pathValue = process.env.PATH ?? ''
  for (const dir of pathValue.split(delimiter)) {
    if (dir) candidates.push(join(dir, 'bun.exe'), join(dir, 'bun'))
  }
  // bun 的默认安装位置（官方安装脚本放这儿）
  candidates.push(
    join(homedir(), '.bun', 'bin', 'bun.exe'),
    join(homedir(), '.bun', 'bin', 'bun'),
  )
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

if (!existsSync(entry)) {
  console.error(`[build-sidecar] 找不到入口：${entry}`)
  process.exit(1)
}

const bun = findBun()
if (!bun) {
  console.error('[build-sidecar] 找不到 bun')
  console.error('')
  console.error('  打发布包需要它 —— 安装包里的 sidecar 是不依赖 Node 的单文件可执行文件。')
  console.error('  开发期不需要：桌面端和 CLI 都会直接跑仓库里的 TypeScript 源码。')
  console.error('')
  console.error('  装 bun：https://bun.sh/docs/installation')
  process.exit(1)
}

mkdirSync(binDir, { recursive: true })

const args = [
  'build',
  '--compile',
  '--outfile',
  outFile,
  entry,
]
console.log(`[build-sidecar] bun ${args.join(' ')}`)
const result = spawnSync(bun, args, {
  stdio: 'inherit',
  cwd: sidecarDir,
  env: process.env,
})
if (result.status !== 0) {
  console.error('[build-sidecar] 构建失败')
  process.exit(result.status ?? 1)
}

if (!existsSync(outFile)) {
  console.error(`[build-sidecar] 找不到产物：${outFile}`)
  process.exit(1)
}
const size = (statSync(outFile).size / 1024 / 1024).toFixed(1)
console.log(`[build-sidecar] 已生成 ${outFile}（${size} MB）`)
