/**
 * sidecar 运行时配置：数据目录、监听端口、访问 token、ENV 占位符解析。
 *
 * 只依赖 Node 内置能力，不引入第三方依赖。
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 默认监听端口 */
export const DEFAULT_PORT = 7801

/** 端口探测上限（含）：默认端口被占用时逐个递增到这里 */
export const MAX_PORT = 7810

/** token 字节数（base64url 编码后约 43 字符） */
export const TOKEN_BYTES = 32

/** 覆盖 app 数据目录的环境变量 */
export const DATA_DIR_ENV = 'AGENT_COMPOSE_DATA_DIR'

/** app 数据目录：环境变量优先，否则落在用户 home 下 */
export function appDataDir(): string {
  const override = process.env[DATA_DIR_ENV]
  if (override !== undefined && override.trim() !== '') return override
  return join(homedir(), '.agent-compose')
}

/** MCP proxy 自己的数据目录（app data 下的 `mcp/` 子目录） */
export function mcpDataDir(): string {
  return join(appDataDir(), 'mcp')
}

/**
 * 运行时信息目录：port 与 token 落在这里。
 *
 * **固定在默认位置，不受 `AGENT_COMPOSE_DATA_DIR` 影响。**
 *
 * 端口与令牌是「哪个 sidecar 在跑」的唯一真相源，gui 侧只认这一处。
 * 若它们跟着数据目录走，多实例（或测试时另设数据目录）就会出现
 * 端口撞上但令牌不同的情况 —— gui 带旧令牌请求，收到 401，
 * 表现成「搜索失败 / 需要登录」，极难排查。
 *
 * 配置数据（servers.json 等）仍放在数据目录，两者职责分开。
 */
export function runtimeDir(): string {
  return join(homedir(), '.agent-compose', 'mcp')
}

/** 生成访问 token：32 字节随机数，base64url 编码 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** 探测端口在 127.0.0.1 上是否可绑定 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => {
      resolve(false)
    })
    probe.once('listening', () => {
      probe.close(() => {
        resolve(true)
      })
    })
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * 从 `start` 起逐个探测可用端口（7801 → 7810）。
 * 全部被占用时抛错，交由调用方决定是否终止启动。
 */
export async function findAvailablePort(
  start: number = DEFAULT_PORT,
  end: number = MAX_PORT,
): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`端口 ${start}-${end} 均被占用，无法为 MCP proxy 分配端口`)
}

/** ENV 占位符：`${ENV:NAME}` */
const ENV_PLACEHOLDER = /\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * 解析字符串里的 `${ENV:NAME}` 占位符：取到环境变量就替换成真实值，
 * 取不到时保留原始占位符字符串（便于 UI 提示“未配置”）。
 */
export function resolveEnvPlaceholders(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return value.replace(ENV_PLACEHOLDER, (match, name: string) => {
    const resolved = env[name]
    return resolved === undefined ? match : resolved
  })
}

/** 解析一整张表（env / headers）里的 ENV 占位符 */
export function resolveEnvRecord(
  record: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(record ?? {})) {
    resolved[key] = resolveEnvPlaceholders(value, env)
  }
  return resolved
}
