/**
 * 密钥（secret）解析。
 *
 * 一个密钥值有两种写法，**两种都要支持**：
 *
 * 1. `${ENV:NAME}` —— 真实值从环境变量读
 *    ```json
 *    { "Authorization": "Bearer ${ENV:FIGMA_TOKEN}" }
 *    ```
 *    好处：令牌不进配置文件，不进版本库，不进日志。
 *
 * 2. 字面量 —— 用户手填的固定值
 *    ```json
 *    { "Authorization": "Bearer g_abc123" }
 *    ```
 *    好处：不用配环境变量，粘上就能用。
 *
 * 解析在**运行时**做，不在写盘时做：
 * 配置文件里永远存原样（占位符或字面量），这样环境变量改了能立刻生效，
 * 配置文件本身也不会因为解析而泄漏真实令牌。
 *
 * ⚠️ 占位符解析不出来时**必须报错**，不能把 `${ENV:NAME}` 原样发出去 ——
 * 服务端只看到一串垃圾，回一个 401，用户完全猜不到是环境变量没配。
 */

/** ENV 占位符：`${ENV:NAME}` */
const ENV_PLACEHOLDER = /\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g

/** 密钥的来源 */
export type SecretSource = 'env' | 'literal'

/** 解析结果 */
export type ResolvedSecret = {
  /** 真实值；解析失败时为空串 */
  value: string
  /** 来源 */
  source: SecretSource
  /** 来源是 env 时，环境变量名 */
  envName?: string
  /** 解析失败的原因（占位符存在但环境变量没设） */
  error?: string
}

/**
 * 解析一个密钥值。
 *
 * - 纯字面量 → 原样返回，source = literal
 * - 含 `${ENV:NAME}` → 取环境变量；取不到就带 error 返回（value 为空串）
 * - 混合（`Bearer ${ENV:X} suffix`）→ 只替换占位符部分
 */
export function resolveSecret(raw: string, env: NodeJS.ProcessEnv = process.env): ResolvedSecret {
  const text = raw ?? ''
  // 找出所有占位符
  const names: string[] = []
  for (const match of text.matchAll(ENV_PLACEHOLDER)) {
    const name = match[1]
    if (name) names.push(name)
  }
  if (!names.length) {
    return { value: text, source: 'literal' }
  }

  // 有占位符但环境变量没设 → 报错，不返回半成品
  const missing = names.filter((name) => {
    const value = env[name]
    return value === undefined || value === ''
  })
  if (missing.length) {
    return {
      value: '',
      source: 'env',
      envName: names[0],
      error: `环境变量 ${missing.join('、')} 未设置`,
    }
  }

  const value = text.replace(ENV_PLACEHOLDER, (_match, name: string) => env[name] ?? '')
  return { value, source: 'env', envName: names[0] }
}

/**
 * 解析一整张表（env / headers）。
 *
 * 有任何一个解析不出来就整张表失败 —— 半张表能用比全不能用更难排查。
 */
export function resolveSecretRecord(
  record: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {}
  const errors: string[] = []
  for (const [key, raw] of Object.entries(record ?? {})) {
    const resolved = resolveSecret(raw, env)
    if (resolved.error) {
      errors.push(`${key}：${resolved.error}（配置里写的是 ${raw}）`)
      continue
    }
    values[key] = resolved.value
  }
  return { values, errors }
}

/**
 * 这个值里有没有占位符。
 *
 * 界面用它显示「令牌来自环境变量 XXX」还是「手动配置的固定值」。
 */
export function secretEnvName(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  for (const match of raw.matchAll(ENV_PLACEHOLDER)) {
    const name = match[1]
    if (name) return name
  }
  return undefined
}
