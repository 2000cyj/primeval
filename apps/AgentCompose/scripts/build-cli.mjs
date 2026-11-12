#!/usr/bin/env node
/**
 * 构建 `agentspace` CLI（Rust，独立 crate）。
 *
 * 为什么要单独一个脚本：CLI 是给终端用的独立可执行文件，跟 Tauri 应用
 * 不是一回事（不链 tauri —— 链了就会拖进 WebView2Loader，终端里跑不起来）。
 *
 * 链接环境跟 `scripts/tauri.mjs` 用同一套结论：本机 Windows + rustup GNU
 * 工具链下，rustc 自带的 dlltool 生成 import library 会失败，必须显式指定
 * MSYS2 MinGW-w64 的 dlltool / gcc（原因见 tauri.mjs 顶部的说明）。
 *
 * 用法：node scripts/build-cli.mjs [--debug]
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
// packageRoot = apps/AgentCompose/ → 上两级是仓库根
const repoRoot = join(packageRoot, '..', '..')
const cliDir = join(repoRoot, 'apps', 'agentspace-cli')
const binDir = join(packageRoot, 'src-tauri', 'bin')
const debug = process.argv.includes('--debug')

/** 读环境变量（Windows 上大小写不敏感）。 */
function readEnv(env, name) {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted) return value ?? ''
  }
  return ''
}

/** 找 MSYS2 MinGW-w64（完整 binutils + mingw 库）。 */
function resolveMsysMingw() {
  const candidates = [
    join(homedir(), 'mingw64', 'bin'),
    'C:/msys64/mingw64/bin',
    'C:/tools/msys64/mingw64/bin',
  ]
  for (const dir of candidates) {
    const gcc = join(dir, 'x86_64-w64-mingw32-gcc.exe')
    const dlltool = join(dir, 'dlltool.exe')
    if (!existsSync(gcc) || !existsSync(dlltool)) continue
    return { dir, gcc, dlltool }
  }
  return null
}

const env = { ...process.env }
const originalPath = readEnv(env, 'PATH')
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'path') delete env[key]
}

const pathEntries = []
const msys = resolveMsysMingw()
if (msys) pathEntries.push(msys.dir)
const cargoBin = join(readEnv(env, 'CARGO_HOME') || join(homedir(), '.cargo'), 'bin')
if (existsSync(cargoBin)) pathEntries.push(cargoBin)
env.PATH = pathEntries.length
  ? `${pathEntries.join(delimiter)}${delimiter}${originalPath}`
  : originalPath

if (msys) {
  // 与 tauri.mjs 相同的首选策略：显式钉住 dlltool 与 linker。
  const flags = [
    '-C',
    `dlltool=${msys.dlltool}`,
    '-C',
    `linker=${msys.gcc}`,
  ]
  const existing = env.RUSTFLAGS ? env.RUSTFLAGS.split(' ').filter(Boolean) : []
  const all = [...existing, ...flags]
  env.RUSTFLAGS = all.join(' ')
  env.CARGO_ENCODED_RUSTFLAGS = all.join('\x1f')
  console.log(`[build-cli] 用 MSYS2 MinGW-w64：${msys.dir}`)
} else {
  console.log('[build-cli] 没找到 MSYS2 MinGW-w64，用默认链接环境')
}

const args = ['build']
if (!debug) args.push('--release')
args.push('--manifest-path', join(cliDir, 'Cargo.toml'))

console.log(`[build-cli] cargo ${args.join(' ')}`)
const result = spawnSync('cargo', args, { stdio: 'inherit', env, cwd: repoRoot })
if (result.status !== 0) {
  console.error('[build-cli] 构建失败')
  process.exit(result.status ?? 1)
}

const built = join(
  cliDir,
  'target',
  debug ? 'debug' : 'release',
  process.platform === 'win32' ? 'agentspace.exe' : 'agentspace',
)
if (!existsSync(built)) {
  console.error(`[build-cli] 找不到产物：${built}`)
  process.exit(1)
}

mkdirSync(binDir, { recursive: true })
const target = join(binDir, process.platform === 'win32' ? 'agentspace.exe' : 'agentspace')
copyFileSync(built, target)
console.log(`[build-cli] 已复制到 ${target}`)
