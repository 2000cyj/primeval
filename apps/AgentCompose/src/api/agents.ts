/**
 * 本机 CLI agent 探测的 Tauri command 封装。
 *
 * 探测逻辑在 Rust 侧（抄 cc-switch 的做法）：
 * 先 PATH 后兜底目录，只跑已定位到的真实可执行文件，
 * 并区分「未安装」与「已安装·无法运行」。
 */
import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'

/** 一处安装 */
export interface AgentInstall {
  /** 可执行文件路径 */
  path: string
  /** `--version` 解析出的版本 */
  version: string | null
  /** `--version` 是否跑通 */
  runnable: boolean
  /** 跑不起来时的诊断 */
  error: string | null
  /** 推断的安装来源：npm / pnpm / bun / nvm / volta / homebrew / scoop */
  source: string
  /** 是否是 PATH 解析到的那处（升级会作用的目标） */
  isPathDefault: boolean
}

/** 探测到的一个 CLI agent */
export interface AgentInfo {
  /** 稳定标识（命令名） */
  id: string
  /** 展示名 */
  name: string
  /** 命令名（终端里敲的那个） */
  command: string
  /** 是否检测到 */
  installed: boolean
  /** 版本号；装了但跑不起来时为空 */
  version: string | null
  /** 可执行文件绝对路径（PATH 默认的那处） */
  path: string | null
  /** 装了但跑不起来的原因 */
  error: string | null
  /** 全部安装位置 */
  installs: AgentInstall[]
  /** npm 包名（可升级的才有） */
  package: string | null
  /** 安装来源 */
  source: string
  /** registry 上的最新版本 */
  latestVersion: string | null
}

/** 包操作方案（安装 / 升级 / 卸载 都是它） */
export interface PackagePlan {
  command: string
  name: string
  package: string
  /** 包管理器：npm / pnpm / bun / volta */
  manager: string
  /** 展示用的命令行 */
  commandLine: string
  /** 升级 / 卸载的目标安装路径；安装时为空 */
  path: string
  /** 实际执行的程序（一般是包管理器的绝对路径） */
  program: string
  /** 实际执行的参数 */
  args: string[]
  /** 装/升的版本（默认 latest） */
  version: string
}

/** 包操作类型 */
export type PackageOp = 'install' | 'upgrade' | 'uninstall'

export const AGENT_COMMANDS = {
  scan: 'agents_scan',
  installations: 'agents_installations',
  checkUpdates: 'agents_check_updates',
  packagePlan: 'agents_package_plan',
  packageVersions: 'agents_package_versions',
  upgrade: 'agents_upgrade',
  install: 'agents_install',
  uninstall: 'agents_uninstall',
} as const

/** 统一的错误包装：保留原始原因，便于界面直接展示 */
function fail(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${action}失败：${detail}`, { cause: error })
}

/** 某个工具的最新版本 */
export interface LatestVersion {
  command: string
  latestVersion: string | null
}

/**
 * 查本地已装工具的最新版本。
 *
 * 单独调用、不挡扫描：npm registry 在慢网络下要好几秒，
 * 版本列晚点出现「有新版本」没关系。
 *
 * 只查传进来的命令（= 扫描时本地确实装上了的那些），没装的不问。
 */
export async function checkUpdates(commands: string[]): Promise<LatestVersion[]> {
  if (!commands.length) return []
  try {
    return await invoke<LatestVersion[]>(AGENT_COMMANDS.checkUpdates, { commands })
  } catch (error) {
    throw fail('检查更新', error)
  }
}

/**
 * 按需枚举某个工具的全部安装位置（每一处都跑 `--version`）。
 *
 * 主扫描只探 PATH 命中的那一处 —— 其余安装位置的版本留到用户展开时再查，
 * 否则每次扫描都要为每个候选 spawn 一次进程。
 */
export async function listInstallations(command: string): Promise<AgentInstall[]> {
  try {
    return await invoke<AgentInstall[]>(AGENT_COMMANDS.installations, { command })
  } catch (error) {
    throw fail('读取安装位置', error)
  }
}

/** 取包操作方案（前端拿它展示「将要执行什么」） */
export async function getPackagePlan(
  command: string,
  op: PackageOp,
  version?: string,
): Promise<PackagePlan> {
  try {
    const plan = await invoke<PackagePlan>(AGENT_COMMANDS.packagePlan, {
      command,
      op,
      version: version ?? null,
    })
    // 后端没给方案就别往下走（不然界面会拿着空数据渲染）
    if (!plan?.commandLine) throw new Error('后端没有返回操作方案')
    return plan
  } catch (error) {
    throw fail('获取操作方案', error)
  }
}

/** 某个包能装的版本（新 → 旧） */
export async function getPackageVersions(command: string): Promise<string[]> {
  try {
    return await invoke<string[]>(AGENT_COMMANDS.packageVersions, { command })
  } catch (error) {
    throw fail('读取版本列表', error)
  }
}

/** 执行升级 */
export async function upgradeAgent(command: string): Promise<string> {
  try {
    return await invoke<string>(AGENT_COMMANDS.upgrade, { command })
  } catch (error) {
    throw fail('升级', error)
  }
}

/** 安装（还没装的时候用） */
export async function installAgent(command: string, version?: string): Promise<string> {
  try {
    return await invoke<string>(AGENT_COMMANDS.install, {
      command,
      version: version ?? null,
    })
  } catch (error) {
    throw fail('安装', error)
  }
}

/** 卸载 */
export async function uninstallAgent(command: string): Promise<string> {
  try {
    return await invoke<string>(AGENT_COMMANDS.uninstall, { command })
  } catch (error) {
    throw fail('卸载', error)
  }
}

/**
 * 最近一次扫描结果。
 *
 * 放在模块级，页面与侧边栏共用一份 —— 侧边栏的计数不该和页面显示的两套数。
 */
export const agentScan = ref<AgentInfo[]>([])

/** 探测本机已安装的 CLI agents */
export async function scanAgents(): Promise<AgentInfo[]> {
  try {
    const agents = await invoke<AgentInfo[]>(AGENT_COMMANDS.scan)
    agentScan.value = agents
    return agents
  } catch (error) {
    throw fail('探测本机 CLI agents', error)
  }
}
