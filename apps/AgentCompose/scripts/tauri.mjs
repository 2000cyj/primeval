#!/usr/bin/env node
/**
 * Tauri CLI launcher for AgentCompose.
 *
 * 背景：本机（Windows 11 + rustup GNU 工具链）上 rustc 生成 import library 时
 * 会 spawn rustup 自带的 dlltool.exe，而这个 spawn 会失败：
 *
 *   error: dlltool could not create import library with ...\self-contained\dlltool.exe ...
 *          ...\self-contained\dlltool.exe: CreateProcess
 *
 * 已排除的可能：dlltool.exe 手动执行完全正常（GNU Binutils 2.44, exit=0），
 * 文件不损坏、依赖 DLL（kernel32/msvcrt/libwinpthread-1.dll）齐全，也没被安全
 * 软件拦截 —— 所以是"rustc 调不动它"，不是"它跑不起来"。
 *
 * 为什么绕不开：getrandom 0.4 的源码注释写得很清楚 ——
 *   // bcryptprimitives.dll lacks an import library, we use "raw-dylib".
 *   #[link(name = "bcryptprimitives", kind = "raw-dylib")]
 * raw-dylib 在 windows-gnu 上必须由 rustc 现场生成 import library，只能靠 dlltool。
 *
 * 做法：不要猜，直接试。启动前用 2 秒的探针编译（一个带 raw-dylib 的 hello.rs）
 * 逐个验证几种 rustc 参数组合，用第一个能编过的组合去跑真正的构建，并把结论打印
 * 出来。探针和真构建走完全一样的环境，所以结论可信。
 *
 * 根因（已定位）：报错的不是 rustc，而是 rustup 自带的 dlltool.exe 自己打的 ——
 * 它在生成 import library 时要 spawn 一个外部程序（汇编器），那个 spawn 失败，
 * binutils 于是打印 "<dlltool.exe>: CreateProcess"。而且 rustup 自带的
 * self-contained\x86_64-w64-mingw32-gcc.exe 只是"链接器专用"的壳（见同目录
 * GCC-WARNING.txt），不含 mingw 的 crt/lib（libkernel32.a、libgcc_eh.a、
 * crtend.o …），所以让 rustc 用它链接会大面积 "cannot find -lxxx"。
 *
 * 解法：本机装了 MSYS2 MinGW-w64（C:\Users\<user>\mingw64\bin），里面的
 * dlltool.exe / windres.exe / x86_64-w64-mingw32-gcc.exe 都是完整可用的，而且
 * 自带全套 mingw 库。所以：
 *   1) 把 MSYS2 的 bin 放到 PATH 最前面（优先于 rustup 的 self-contained），
 *      让 rustc 的 linker（x86_64-w64-mingw32-gcc）和 tauri-build 需要的
 *      windres 都解析到 MSYS2 的版本；
 *   2) 用 -C dlltool=<MSYS2 dlltool> 显式指定 import library 生成器；
 *   3) 用 -C linker=<MSYS2 gcc> 显式钉住链接器，避免 PATH 顺序变化导致回归。
 * 若本机没有 MSYS2，则回退到原有的探针策略列表。
 *
 * 另外处理两个环境问题：
 *   1) rustup 默认装在 ~/.cargo/bin，不在 PATH 里会报 "cargo not found"；
 *   2) 工作目录固定成包根（含 src-tauri 的上一级），tauri CLI 才能找到
 *      src-tauri/tauri.conf.json。
 *
 * 用法：node scripts/tauri.mjs <tauri-cli args...>
 * 环境变量：
 *   AGENT_COMPOSE_SKIP_PROBE=1   跳过探针，直接用默认参数
 *   AGENT_COMPOSE_RUSTFLAGS=...   覆盖探针结论，强制指定 rustc 参数
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const tauriDir = join(packageRoot, 'src-tauri')
const rustupHome = process.env.RUSTUP_HOME || join(homedir(), '.rustup')
const toolchainsDir = join(rustupHome, 'toolchains')

/** 找出本机的 MSYS2 MinGW-w64（带完整 binutils + mingw 库），找不到返回 null */
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
    return {
      dir,
      gcc,
      dlltool,
      windres: join(dir, 'windres.exe'),
      as: join(dir, 'as.exe'),
    }
  }
  return null
}

/** 找出 rustup 的 GNU 工具链，以及它自带的 binutils / lib */
function resolveGnuToolchain() {
  if (!existsSync(toolchainsDir)) return null
  const name = readdirSync(toolchainsDir).find((n) => n.endsWith('-x86_64-pc-windows-gnu'))
  if (!name) return null
  const root = join(toolchainsDir, name)
  const targetDir = join(root, 'lib', 'rustlib', 'x86_64-pc-windows-gnu')
  const selfContained = join(targetDir, 'bin', 'self-contained')
  if (!existsSync(selfContained)) return null
  return {
    root,
    bin: join(root, 'bin'),
    selfContained,
    gcc: join(selfContained, 'x86_64-w64-mingw32-gcc.exe'),
    rustLld: join(targetDir, 'bin', 'rust-lld.exe'),
  }
}

const baseEnv = { ...process.env }
const pathEntries = []

/**
 * Windows 上环境变量名大小写不敏感，但 `{ ...process.env }` 只是把键原样拷贝成
 * 一个普通对象：原生 Windows shell（cmd / PowerShell / 资源管理器）里的变量名
 * 是 "Path"，拷过来仍然是 "Path"，于是 `baseEnv.PATH` 直接是 undefined。
 * 之前那段拼 PATH 的代码就会得到 "msys2;cargo;rustup;self-contained;"，
 * 把 node.exe / pnpm 之类全丢掉 —— 子进程里就报
 * "'node' 不是内部或外部命令"。
 * 所以：按大小写不敏感取原值，并且只保留一个 PATH 键，避免环境块里同时存在
 * "Path" 和 "PATH" 让 cmd 随机挑一个。
 */
function readEnvValue(env, name) {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted) return value ?? ''
  }
  return ''
}

const originalPath = readEnvValue(baseEnv, 'PATH')
for (const key of Object.keys(baseEnv)) {
  if (key.toLowerCase() === 'path') delete baseEnv[key]
}

const msysMingw = resolveMsysMingw()

// MSYS2 MinGW-w64 必须排在最前：rustc 的 linker 是 "x86_64-w64-mingw32-gcc"，
// 如果先命中 rustup 的 self-contained 壳（不含 mingw 库），链接会大面积报
// "cannot find -lkernel32 / -lgcc_eh / crtend.o"。
if (msysMingw) {
  pathEntries.push(msysMingw.dir)
}

// ~/.cargo/bin —— cargo / rustc 的 rustup shim
const cargoHome = readEnvValue(baseEnv, 'CARGO_HOME') || join(homedir(), '.cargo')
const cargoBin = join(cargoHome, 'bin')
if (existsSync(cargoBin)) pathEntries.push(cargoBin)

const toolchain = resolveGnuToolchain()
if (toolchain) {
  pathEntries.push(toolchain.bin)
  // self-contained 必须在 PATH 里：让 rustc 能按名字找到 dlltool
  pathEntries.push(toolchain.selfContained)
}
if (pathEntries.length) {
  baseEnv.PATH = `${pathEntries.join(delimiter)}${delimiter}${originalPath}`
} else {
  baseEnv.PATH = originalPath
}

/** 把 rustc 参数同时写进 RUSTFLAGS 和 CARGO_ENCODED_RUSTFLAGS（后者覆盖 build script） */
function withRustFlags(env, flags) {
  const existing = env.RUSTFLAGS ? env.RUSTFLAGS.split(' ').filter(Boolean) : []
  const all = [...existing, ...flags]
  return {
    ...env,
    RUSTFLAGS: all.join(' '),
    CARGO_ENCODED_RUSTFLAGS: all.join('\x1f'),
  }
}

/**
 * 候选策略，按顺序试。
 * 关键点是 `-C link-self-contained=...,-tools`：保留 crt 对象 / stdlib / 链接器
 * （它们都在 sysroot 里，缺一不可），只把 tools 关掉 —— rustc 就不再用 sysroot 里
 * 那条绝对路径去 spawn dlltool，而是改成从 PATH 里按名字找。
 */
function strategies() {
  const list = [{ name: 'default', flags: [] }]

  // 首选：MSYS2 MinGW-w64 —— dlltool / windres / gcc + 全套 mingw 库都可用。
  if (msysMingw) {
    list.unshift({
      name: 'msys2-mingw',
      flags: ['-C', `dlltool=${msysMingw.dlltool}`, '-C', `linker=${msysMingw.gcc}`],
    })
  }

  if (!toolchain) return list

  // 注：rustc 1.99 的合法组件名是 crto / libc / unwind / linker / sanitizers /
  // mingw（没有 crt-objects / stdlib / tools，老写法会被 rustc 直接拒绝）。
  const surgical = ['-C', 'link-self-contained=+crto,+libc,+unwind,+linker']
  list.push({ name: 'dlltool-from-PATH', flags: surgical })

  if (existsSync(toolchain.gcc)) {
    list.push({
      name: 'dlltool-from-PATH+gcc',
      flags: [...surgical, '-C', `linker=${toolchain.gcc}`],
    })
  }
  if (existsSync(toolchain.rustLld)) {
    list.push({
      name: 'dlltool-from-PATH+lld',
      flags: [...surgical, '-C', `linker=${toolchain.rustLld}`, '-C', 'linker-flavor=gnu-lld'],
    })
  }
  list.push({
    name: 'link-self-contained=no',
    flags: [
      '-C',
      'link-self-contained=no',
      ...(existsSync(toolchain.gcc) ? ['-C', `linker=${toolchain.gcc}`] : []),
    ],
  })

  // 把 self-contained 的 binutils 复制到临时目录再从 PATH 找 —— 用来排除
  // "从 .rustup\toolchains\... 路径启动进程被拦" 这类按路径拦截的情况
  const copied = copySelfContainedTools()
  if (copied) {
    list.push({
      name: 'dlltool-from-temp-copy',
      flags: surgical,
      extraPath: copied,
    })
  }
  return list
}

/** 把 dlltool.exe + 它依赖的 libwinpthread-1.dll 复制到临时目录，返回该目录 */
function copySelfContainedTools() {
  if (!toolchain) return ''
  const dir = mkdtempSync(join(tmpdir(), 'agent-compose-binutils-'))
  try {
    for (const file of ['dlltool.exe', 'libwinpthread-1.dll']) {
      const from = join(toolchain.selfContained, file)
      if (!existsSync(from)) continue
      copyFileSync(from, join(dir, file))
    }
    return dir
  } catch {
    rmSync(dir, { recursive: true, force: true })
    return ''
  }
}

/** 探针：编译一个必须生成 import library 的小程序，逼 rustc 走 dlltool */
const PROBE_SOURCE = `#[link(name = "kernel32", kind = "raw-dylib")]
extern "system" {
    fn GetLastError() -> u32;
}

fn main() {
    unsafe { println!("{}", GetLastError()) }
}
`

function probe(strategy) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-compose-rust-probe-'))
  try {
    const src = join(dir, 'probe.rs')
    writeFileSync(src, PROBE_SOURCE)
    const env = withRustFlags(baseEnv, strategy.flags)
    if (strategy.extraPath) {
      env.PATH = `${strategy.extraPath}${delimiter}${env.PATH || ''}`
    }
    // 注意:RUSTFLAGS 是 cargo 认的环境变量,直接调 rustc 不认,
    // 所以参数必须原样作为 rustc 的命令行参数传进去。
    const result = spawnSync(
      'rustc',
      ['--edition', '2021', ...strategy.flags, src, '-o', join(dir, 'probe.exe')],
      {
        cwd: dir,
        env,
        encoding: 'utf8',
        timeout: 120_000,
      },
    )
    return {
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function pickStrategy() {
  const forced = process.env.AGENT_COMPOSE_RUSTFLAGS
  if (forced) {
    console.log(`[tauri.mjs] 使用环境变量指定的 rustc 参数:${forced}`)
    return { name: 'forced', flags: forced.split(' ').filter(Boolean) }
  }
  if (process.env.AGENT_COMPOSE_SKIP_PROBE) {
    console.log('[tauri.mjs] 已跳过探针(AGENT_COMPOSE_SKIP_PROBE=1)')
    return { name: 'default', flags: [] }
  }

  const candidates = strategies()
  for (const candidate of candidates) {
    const result = probe(candidate)
    if (result.ok) {
      console.log(`[tauri.mjs] 探针通过 → 策略:${candidate.name}`)
      return candidate
    }
    const firstError = result.output.split('\n').find((line) => /error/i.test(line)) || ''
    console.log(
      `[tauri.mjs] 探针失败 → 策略:${candidate.name}${firstError ? ` | ${firstError.trim()}` : ''}`,
    )
  }
  console.warn('[tauri.mjs] 所有策略都不可用，将按默认参数启动（错误信息以 Tauri 输出为准）')
  return { name: 'default', flags: [] }
}

/**
 * 端口预检：vite 的 strictPort:true 意味着端口被占就直接报错，而且报错信息
 * 只是一句 "Port 5176 is already in use"，用户不知道是谁占的。
 * 这里在启动 Tauri 之前先查清楚：
 *   - 占用者是本项目（命令��含本包路径）的残留 dev 进程 → 直接杀掉再继续；
 *   - 占用者是别的程序 → 打印 PID + 命令行并退出，不要默默失败。
 */
function readDevPort() {
  const confPath = join(tauriDir, 'tauri.conf.json')
  try {
    const conf = JSON.parse(readFileSync(confPath, 'utf8'))
    const url = conf?.build?.devUrl
    const port = url ? Number(new URL(url).port) : 0
    if (port) return port
  } catch {
    /* 配置读不到就退回默认端口 */
  }
  return 5176
}

function findPortOwner(port) {
  if (process.platform !== 'win32') return null
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || ''
  for (const line of out.split(/\r?\n/)) {
    if (!new RegExp(`[:.]${port}\\s`).test(line)) continue
    if (!/LISTENING/i.test(line)) continue
    const pid = Number(line.trim().split(/\s+/).pop())
    if (Number.isFinite(pid) && pid > 0) return pid
  }
  return null
}

function describePid(pid) {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
    ],
    { encoding: 'utf8' },
  )
  return (ps.stdout || '').trim()
}

function killPid(pid) {
  return spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf8' }).status === 0
}

/**
 * 残留的 dev 进程栈：vite 被杀后，父进程 tauri.js 还会继续跑，而且它派生的
 * cargo / rustc / build script 会继续持有 target 目录里的产物
 * （libresource.a）和 cargo 的构建锁 —— 新实例要么卡在
 * "Blocking waiting for file lock on build directory"，
 * 要么在 build script 写 libresource.a 时报
 * "另一个程序正在使用此文件，进程无法访问. (os error 32)"。
 * 所以要按进程树自底向上整棵杀掉。
 * 根的识别方式：node.exe 且命令行含 AgentCompose 且含 tauri.js
 * （本进程的命令行是 "node scripts/tauri.mjs dev"，不含 tauri.js，不会误伤）。
 */
function killStaleDevStack() {
  const script = [
    '$all = Get-CimInstance Win32_Process',
    '$roots = $all | Where-Object {',
    "  $_.Name -eq 'node.exe' -and",
    "  $_.CommandLine -match 'AgentCompose' -and",
    "  $_.CommandLine -match 'tauri\\.js'",
    '}',
    'if (-not $roots) { exit 0 }',
    '$seen = @{}',
    'foreach ($r in $roots) { $seen[[int]$r.ProcessId] = 0 }',
    'do {',
    '  $added = $false',
    '  foreach ($p in $all) {',
    '    $ppid = [int]$p.ParentProcessId',
    '    if ($seen.ContainsKey($ppid) -and -not $seen.ContainsKey([int]$p.ProcessId)) {',
    '      $seen[[int]$p.ProcessId] = $seen[$ppid] + 1',
    '      $added = $true',
    '    }',
    '  }',
    '} while ($added)',
    '# 深度大的先杀（子进程先于父进程）',
    'foreach ($id in ($seen.Keys | Sort-Object { $seen[$_] } -Descending)) {',
    '  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue',
    '  Write-Output ("killed " + $id)',
    '}',
  ].join(' ')
  const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  const killed = (out.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  if (killed.length) console.log(`[tauri.mjs] 已清理残留进程 ${killed.length} 个`)
}

function releaseDevPort() {
  if (process.env.AGENT_COMPOSE_KEEP_STALE === '1') return
  const port = readDevPort()
  const pid = findPortOwner(port)
  if (!pid) return

  const cmdline = describePid(pid)
  const isOwnStale = cmdline.includes('AgentCompose') || cmdline.includes('agent-compose')
  if (isOwnStale) {
    console.log(`[tauri.mjs] 端口 ${port} 被本项目的残留进程占用(PID ${pid})，正在清理…`)
    if (killPid(pid)) {
      console.log(`[tauri.mjs] 已结束 PID ${pid}`)
    } else {
      console.warn(`[tauri.mjs] 结束 PID ${pid} 失败，请手动执行: taskkill /F /PID ${pid}`)
    }
    killStaleDevStack()
    // 给操作系统一点时间释放端口
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && findPortOwner(port)) {
      spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 200'])
    }
    if (!findPortOwner(port)) console.log(`[tauri.mjs] 端口 ${port} 已释放`)
    return
  }

  console.error(
    `[tauri.mjs] 端口 ${port} 已被其他程序占用(PID ${pid})，无法启动 dev server。\n` +
      `  命令行:${cmdline || '(未知)'}\n` +
      `  请先释放该端口，或设置 AGENT_COMPOSE_KEEP_STALE=1 跳过检查（不推荐）。`,
  )
  process.exit(1)
}

// 只有 dev 需要 dev server 端口；build 不需要
if (process.argv.slice(2).some((arg) => arg === 'dev' || arg === '--dev')) {
  releaseDevPort()
}

// build 前置检查：两个随包分发的可执行文件都得先构建出来。
//
// 它们在 `src-tauri/bin/`（gitignore），打包时当 resource 带进安装包。
// 缺了不会让 tauri 报错 —— 它只会打出一个「装完 MCP 用不了」的包，
// 所以在这儿挡住，给出能照着做的提示。
const isBuild = process.argv.slice(2).some((arg) => arg === 'build')
if (isBuild) {
  const binDir = join(packageRoot, 'src-tauri', 'bin')
  const exe = (name) => join(binDir, process.platform === 'win32' ? `${name}.exe` : name)
  const missing = [exe('agentspace'), exe('agent-compose-mcp')].filter(
    (path) => !existsSync(path),
  )
  if (missing.length) {
    console.error('[tauri.mjs] build 缺少随包分发的可执行文件：')
    for (const path of missing) {
      console.error(`  - ${path}`)
    }
    console.error('')
    console.error('  先构建它们：')
    console.error('    node scripts/build-cli.mjs        （agentspace CLI）')
    console.error('    node scripts/build-sidecar.mjs    （MCP 代理）')
    console.error('')
    console.error('  或者直接跑 pnpm build，它会把两步都带上。')
    process.exit(1)
  }
}

const chosen = pickStrategy()
const env = withRustFlags(baseEnv, chosen.flags)
if (chosen.extraPath) {
  env.PATH = `${chosen.extraPath}${delimiter}${env.PATH || ''}`
}

const tauriBin = join(
  packageRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.CMD' : 'tauri',
)
if (!existsSync(tauriBin)) {
  console.error(`[tauri.mjs] 找不到 Tauri CLI:${tauriBin}\n请先在仓库根执行 pnpm install。`)
  process.exit(1)
}

const child = spawn(tauriBin, process.argv.slice(2), {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
  cwd: packageRoot,
})

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
child.on('error', (error) => {
  console.error(`[tauri.mjs] 启动 Tauri CLI 失败:${error.message}`)
  process.exit(1)
})
