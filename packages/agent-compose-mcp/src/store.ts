/**
 * 配置持久化：servers.json / exposure.json / profiles.json。
 *
 * - 原子写：先写同目录临时文件，再 rename 覆盖，避免半截文件。
 * - 读容错：文件缺失或 JSON 损坏时回落到默认值，不抛错。
 * - 内存态：Store 持有当前配置，写入后同步更新。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventBus } from './events.ts'
import type { McpConfigFile, McpExposure, McpProfile, McpServerDef, McpToolInfo } from './types.ts'
import { defaultExposure } from './types.ts'
import type { OAuthRecord } from './oauth.ts'

/** 上游 server 列表文件名 */
export const SERVERS_FILE = 'servers.json'
/** 暴露配置文件名 */
export const EXPOSURE_FILE = 'exposure.json'
/** profile 列表文件名 */
export const PROFILES_FILE = 'profiles.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 取配置文件里的某个分片（servers / exposure / profiles） */
function section(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 宽松校验一条 server 定义：非法项直接丢弃，不让脏数据流到运行时 */
function parseServer(value: unknown): McpServerDef | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const name = value['name']
  const transport = value['transport']
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof name !== 'string') return undefined
  if (transport !== 'stdio' && transport !== 'http') return undefined

  const def: McpServerDef = {
    id,
    name,
    transport,
    enabled: value['enabled'] !== false,
  }
  if (typeof value['command'] === 'string') def.command = value['command']
  if (Array.isArray(value['args'])) def.args = asStringArray(value['args'])
  if (isRecord(value['env'])) {
    const env: Record<string, string> = {}
    for (const [key, item] of Object.entries(value['env'])) {
      if (typeof item === 'string') env[key] = item
    }
    def.env = env
  }
  if (typeof value['url'] === 'string') def.url = value['url']
  // 认证方式：漏掉它会让 oauth 上游退化成「无认证」，报出误导性的 401
  const auth = value['auth']
  if (auth === 'none' || auth === 'static' || auth === 'oauth') def.auth = auth
  if (isRecord(value['headers'])) {
    const headers: Record<string, string> = {}
    for (const [key, item] of Object.entries(value['headers'])) {
      if (typeof item === 'string') headers[key] = item
    }
    def.headers = headers
  }
  // 手动配置的令牌：字面量或 ${ENV:NAME} 占位，两者都支持
  if (typeof value['token'] === 'string' && value['token'] !== '') {
    def.token = value['token']
  }
  // 来自官方目录的条目名 —— 数据管理导出时靠它判「目录装的 vs 手动填的」
  if (typeof value['registryName'] === 'string' && value['registryName'] !== '') {
    def.registryName = value['registryName']
  }
  return def
}

function parseServers(value: unknown): McpServerDef[] {
  if (!Array.isArray(value)) return []
  const servers: McpServerDef[] = []
  for (const item of value) {
    const parsed = parseServer(item)
    if (parsed) servers.push(parsed)
  }
  return servers
}

function parseExposure(value: unknown): McpExposure {
  const fallback = defaultExposure()
  if (!isRecord(value)) return fallback
  const maxTools = value['maxTools']
  return {
    serverIds: asStringArray(value['serverIds']),
    toolKeys: asStringArray(value['toolKeys']),
    maxTools:
      typeof maxTools === 'number' && Number.isFinite(maxTools) ? maxTools : fallback.maxTools,
  }
}

function parseProfiles(value: unknown): McpProfile[] {
  if (!Array.isArray(value)) return []
  const profiles: McpProfile[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = item['id']
    const name = item['name']
    if (typeof id !== 'string' || id === '') continue
    if (typeof name !== 'string') continue
    profiles.push({ id, name, serverIds: asStringArray(item['serverIds']) })
  }
  return profiles
}

export class Store {
  private readonly dir: string
  private readonly bus: EventBus | undefined
  private config: McpConfigFile = {
    servers: [],
    exposure: defaultExposure(),
    profiles: [],
  }

  constructor(dir: string, bus?: EventBus) {
    this.dir = dir
    this.bus = bus
  }

  /**
   * 从磁盘读取全部配置并更新内存态。
   */
  async load(): Promise<McpConfigFile> {
    const servers = parseServers(section(await this.readJson(SERVERS_FILE), 'servers'))
    const exposure = parseExposure(section(await this.readJson(EXPOSURE_FILE), 'exposure'))
    const profiles = parseProfiles(section(await this.readJson(PROFILES_FILE), 'profiles'))
    this.config = { servers, exposure, profiles }
    return this.config
  }

  /**
   * 当前配置快照。
   */
  getConfig(): McpConfigFile {
    return this.config
  }

  getServers(): McpServerDef[] {
    return this.config.servers
  }

  async setServers(servers: McpServerDef[]): Promise<void> {
    this.config.servers = servers
    await this.writeJson(SERVERS_FILE, { servers })
    this.bus?.emit('config-changed', { kind: 'servers' })
  }

  getExposure(): McpExposure {
    return this.config.exposure
  }

  async setExposure(exposure: McpExposure): Promise<void> {
    this.config.exposure = exposure
    await this.writeJson(EXPOSURE_FILE, { exposure })
    this.bus?.emit('config-changed', { kind: 'exposure' })
  }

  getProfiles(): McpProfile[] {
    return this.config.profiles
  }

  async setProfiles(profiles: McpProfile[]): Promise<void> {
    this.config.profiles = profiles
    await this.writeJson(PROFILES_FILE, { profiles })
    this.bus?.emit('config-changed', { kind: 'profiles' })
  }

  /** 读取并解析 JSON 文件；缺失或损坏时返回 undefined */
  private async readJson(file: string): Promise<unknown> {
    try {
      const raw = await readFile(join(this.dir, file), 'utf8')
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  }

  /** 原子写：先写临时文件，再 rename 覆盖目标文件 */
  private async writeJson(file: string, data: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const target = join(this.dir, file)
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    await rename(temp, target)
  }
}

/** oauth 令牌文件名 */
export const OAUTH_FILE = 'oauth.json'

/** 工具清单缓存文件名 */
export const TOOLS_FILE = 'tools.json'

/**
 * 一个上游的工具清单缓存。
 *
 * 为什么要缓存：上游是**惰性连接**的 —— 不主动连就没有工具清单。
 * 后果是：每次打开 MCP 页，所有上游都显示「未连接 / 0 个工具」，
 * 用户没法在不重新连一遍的情况下看到上次拿到过什么；
 * 「配置暴露」里勾选工具也得先连上才行。
 *
 * 所以连上之后把工具清单落盘，下次直接读缓存。
 */
export type CachedTools = {
  /** 工具清单 */
  tools: McpToolInfo[]
  /** 缓存时间（epoch 毫秒） */
  cachedAt: number
}

/**
 * 工具清单缓存（按 server id 分片存放在 `tools.json`）。
 */
export class ToolCacheStore {
  private readonly dir: string
  private cache: Record<string, CachedTools> | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  private async loadAll(): Promise<Record<string, CachedTools>> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(join(this.dir, TOOLS_FILE), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.cache = isRecord(parsed) ? (parsed as Record<string, CachedTools>) : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  async read(serverId: string): Promise<CachedTools | undefined> {
    const all = await this.loadAll()
    return all[serverId]
  }

  async write(serverId: string, tools: McpToolInfo[]): Promise<void> {
    const all = await this.loadAll()
    all[serverId] = { tools, cachedAt: Date.now() }
    await this.save(all)
  }

  async remove(serverId: string): Promise<void> {
    const all = await this.loadAll()
    if (!(serverId in all)) return
    delete all[serverId]
    await this.save(all)
  }

  /** 全部缓存 */
  async all(): Promise<Record<string, CachedTools>> {
    return this.loadAll()
  }

  private async save(all: Record<string, CachedTools>): Promise<void> {
    this.cache = all
    await mkdir(this.dir, { recursive: true })
    const file = join(this.dir, TOOLS_FILE)
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
    await rename(tmp, file)
  }
}

/**
 * OAuth 令牌存储。
 *
 * 令牌按 server id 分片存放在 `oauth.json`。文件权限在 unix 上设为 0600；
 * windows 上依赖用户目录本身的 acl。
 *
 * ⚠️ 取舍：令牌目前是明文落盘。生产环境应换成系统钥匙串
 * （keyring / tauri-plugin-stronghold），这里先保证功能可用。
 */
export class OAuthFileStore {
  private readonly dir: string
  private cache: Record<string, OAuthRecord> | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  private async loadAll(): Promise<Record<string, OAuthRecord>> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(join(this.dir, OAUTH_FILE), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.cache = isRecord(parsed) ? (parsed as Record<string, OAuthRecord>) : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  async read(serverId: string): Promise<OAuthRecord | undefined> {
    const all = await this.loadAll()
    return all[serverId]
  }

  async write(serverId: string, record: OAuthRecord): Promise<void> {
    const all = await this.loadAll()
    all[serverId] = record
    await mkdir(this.dir, { recursive: true })
    const file = join(this.dir, OAUTH_FILE)
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(all, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  }
}
