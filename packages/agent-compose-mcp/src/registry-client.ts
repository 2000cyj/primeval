/**
 * 官方 MCP Registry（https://registry.modelcontextprotocol.io）客户端。
 *
 * 目录里的条目自带包安装方式（packages）或远程端点（remotes），
 * 可以直接翻译成本项目的上游定义，用户不必手填 command / args。
 */
import type {
  McpRegistryEntry,
  McpRegistryPackage,
  McpRegistryRemote,
  McpRegistrySearchResult,
  McpServerDef,
} from './types.ts'

/** 官方 registry 的 v0 接口 */
const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0/servers'

/** registry 返回的单条结构 */
type RawItem = {
  server?: {
    name?: string
    title?: string
    description?: string
    version?: string
    homepage?: string
    repository?: { url?: string; source?: string }
    packages?: McpRegistryPackage[]
    remotes?: McpRegistryRemote[]
  }
  _meta?: Record<string, unknown>
}

/** 判断一个包是否适合本地 stdio 启动 */
function isLocalPackage(pkg: McpRegistryPackage | undefined): boolean {
  if (!pkg) return false
  const type = pkg.transport?.type ?? 'stdio'
  if (type !== 'stdio') return false
  // oci 需要 docker，本项目暂不支持本地拉起
  if (pkg.registryType === 'oci') return false
  return Boolean(pkg.identifier)
}

/**
 * 把 registry 里的包翻译成启动命令。
 *
 * - npm → `npx -y <pkg>@<version>`
 * - pypi → `uvx <pkg>`
 * - 其余 → 用 registry 给的 runtimeHint，兜底 npx
 */
export function packageToCommand(pkg: McpRegistryPackage): {
  command: string
  args: string[]
} {
  const identifier = pkg.identifier ?? ''
  const runtimeHint = pkg.runtimeHint?.trim()
  const version = pkg.version?.trim()

  let command: string
  let args: string[]

  if (pkg.registryType === 'pypi') {
    command = runtimeHint || 'uvx'
    args = [identifier]
  } else if (pkg.registryType === 'npm') {
    command = runtimeHint || 'npx'
    args = ['-y', version ? `${identifier}@${version}` : identifier]
  } else {
    command = runtimeHint || 'npx'
    args = version ? [`${identifier}@${version}`] : [identifier]
  }

  // registry 声明的额外位置参数
  for (const arg of pkg.runtimeArguments ?? []) {
    if (arg.value) args.push(arg.value)
  }

  return { command, args }
}

/** 把 registry 条目翻译成本项目的上游定义。 */
export function entryToServerDef(entry: McpRegistryEntry): McpServerDef | null {
  const localPkg = entry.packages?.find(isLocalPackage)
  if (localPkg) {
    const { command, args } = packageToCommand(localPkg)
    const env: Record<string, string> = {}
    for (const item of localPkg.environmentVariables ?? []) {
      if (!item.name) continue
      // 用占位符，真实值由用户填或在环境变量里给
      env[item.name] = `\${ENV:${item.name}}`
    }
    return {
      id: entry.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
      name: entry.title || entry.name,
      transport: 'stdio',
      command,
      args,
      env: Object.keys(env).length ? env : undefined,
      enabled: true,
    }
  }

  const remote = entry.remotes?.find((item) => Boolean(item.url))
  if (remote?.url) {
    const headers: Record<string, string> = {}
    for (const item of remote.headers ?? []) {
      if (!item.name) continue
      headers[item.name] =
        item.value || `\${ENV:${item.name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}}`
    }
    return {
      id: entry.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
      name: entry.title || entry.name,
      transport: 'http',
      url: remote.url,
      headers: Object.keys(headers).length ? headers : undefined,
      enabled: true,
    }
  }

  return null
}

/**
 * 宽松的版本号比较。
 *
 * registry 会把同一 server 的多个版本都返回（例如 0.1.2 / 0.1.3 / 0.1.5），
 * 搜索结果里需要只留最新的一个。版本号不一定是严格 semver
 * （可能带预发布后缀），所以按数字分段比较，数字相同时后面的更新。
 */
export function compareVersions(a?: string, b?: string): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  const pa = a.split(/[.\-+]/)
  const pb = b.split(/[.\-+]/)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const na = Number.parseInt(pa[i] ?? '', 10)
    const nb = Number.parseInt(pb[i] ?? '', 10)
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = pa[i] ?? ''
      const sb = pb[i] ?? ''
      if (sa !== sb) return sa > sb ? 1 : -1
      continue
    }
    if (na !== nb) return na > nb ? 1 : -1
  }
  return 0
}

/**
 * 按 name 去重，同名只保留版本最新的一个。
 *
 * 官方 registry 对同一个 server 会按版本返回多条，不去重的话搜索结果
 * 会被同一个 server 的历史版本淹没。
 */
export function dedupeByName(entries: McpRegistryEntry[]): McpRegistryEntry[] {
  const best = new Map<string, McpRegistryEntry>()
  for (const entry of entries) {
    const current = best.get(entry.name)
    if (!current || compareVersions(entry.version, current.version) > 0) {
      best.set(entry.name, entry)
    }
  }
  return [...best.values()]
}

/** 把 registry 的原始响应转成条目列表 */
function toEntries(raw: unknown): McpRegistryEntry[] {
  const items = Array.isArray((raw as { servers?: unknown })?.servers)
    ? ((raw as { servers: RawItem[] }).servers ?? [])
    : []
  const out: McpRegistryEntry[] = []
  for (const item of items) {
    const server = item.server
    if (!server?.name) continue
    out.push({
      name: server.name,
      title: server.title,
      description: server.description,
      version: server.version,
      homepage: server.homepage,
      repository: server.repository,
      packages: server.packages,
      remotes: server.remotes,
      official: Boolean(item._meta?.['io.modelcontextprotocol.registry/official']),
    })
  }
  return out
}

/**
 * 在官方 registry 里搜索。
 *
 * @param query 关键词，空串表示浏览全部
 * @param cursor 分页游标
 */
export async function searchRegistry(
  query: string,
  cursor?: string,
  limit = 20,
): Promise<McpRegistrySearchResult> {
  const url = new URL(REGISTRY_BASE)
  const keyword = query.trim()
  if (keyword) url.searchParams.set('search', keyword)
  url.searchParams.set('limit', String(limit))
  if (cursor) url.searchParams.set('cursor', cursor)

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'agent-compose-mcp/0.1' },
  })
  if (!response.ok) {
    throw new Error(`目录服务返回 ${response.status}`)
  }

  const raw = (await response.json()) as { servers?: RawItem[]; metadata?: { nextCursor?: string } }
  return {
    entries: dedupeByName(toEntries(raw)),
    nextCursor: raw.metadata?.nextCursor,
    source: 'registry.modelcontextprotocol.io',
  }
}
