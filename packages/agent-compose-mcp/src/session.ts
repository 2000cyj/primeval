/**
 * MCP 会话层：把 agent 的一个请求映射到一份「对外可见的工具视图」，
 * 并把工具调用路由回上游。
 *
 * 粒度由 URL 路径表达（见 types.ts 的 McpSelection）：
 *   /mcp              全部启用的 server，工具名带 `serverId__` 前缀
 *   /mcp/s/{id}       单个 server，工具名**不带前缀**（原始名，agent 侧最干净）
 *   /mcp/s/{a}+{b}    临时组合，工具名带前缀
 *   /mcp/p/{profile}  命名 profile，工具名带前缀
 */
import { Server, type JSONValue } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/client'
import type { EventBus } from './events.ts'
import type { ToolRegistry, ExposedTool } from './registry.ts'
import type { UpstreamPool } from './upstream.ts'
import type { McpProfile, McpSelection } from './types.ts'
import { MCP_NS_SEPARATOR } from './types.ts'

/** 一个视图里对外可见的工具 */
export type ViewTool = {
  /** 对外工具名（单 server 视图下是原始名，其余带前缀） */
  name: string
  description?: string
  /** JSON Schema，原样透传 */
  inputSchema: unknown
}

/** 一次请求对应的工具视图 */
export type McpView = {
  selection: McpSelection
  tools: ViewTool[]
  /** 对外工具名 → registry 内部名（带前缀）。调用路由靠它反查。 */
  outwardToExposed: Map<string, string>
}

/**
 * 从 URL 路径解析粒度。
 *
 * `/mcp`            → all
 * `/mcp/s/github`   → server
 * `/mcp/s/a+b`      → servers
 * `/mcp/p/backend`  → profile
 */
export function parseSelection(pathname: string): McpSelection {
  const path = pathname.replace(/\/+$/, '') || '/mcp'
  const prefix = '/mcp'

  if (path === prefix || path === '') return { kind: 'all' }

  if (path.startsWith(`${prefix}/s/`)) {
    const raw = decodeURIComponent(path.slice(`${prefix}/s/`.length))
    const ids = raw
      .split('+')
      .map((id) => id.trim())
      .filter(Boolean)
    if (ids.length === 0) return { kind: 'all' }
    const only = ids[0]
    if (ids.length === 1 && only) return { kind: 'server', serverId: only }
    return { kind: 'servers', serverIds: ids }
  }

  if (path.startsWith(`${prefix}/p/`)) {
    const id = decodeURIComponent(path.slice(`${prefix}/p/`.length)).trim()
    if (!id) return { kind: 'all' }
    return { kind: 'profile', profileId: id }
  }

  return { kind: 'all' }
}

/** 解析粒度对应的 server id 列表（profile 需查表；查不到视为空） */
function resolveServerIds(
  selection: McpSelection,
  profiles: McpProfile[],
): { ids: string[]; prefixed: boolean } {
  switch (selection.kind) {
    case 'all':
      return { ids: [], prefixed: true }
    case 'server':
      // 单 server：工具名不带前缀
      return { ids: [selection.serverId], prefixed: false }
    case 'servers':
      return { ids: selection.serverIds, prefixed: true }
    case 'profile': {
      const profile = profiles.find((item) => item.id === selection.profileId)
      return { ids: profile?.serverIds ?? [], prefixed: true }
    }
  }
}

/** MCP Tool 的 inputSchema 形状（v2 要求顶层为 object schema） */
export type ToolInputSchema = {
  type: 'object'
  properties?: Record<string, JSONValue>
  required?: string[]
  [key: string]: unknown
}

/**
 * 把上游的 JSON Schema 归一化成 MCP Tool 的 inputSchema。
 *
 * v2 的 Tool.inputSchema 顶层必须是 object schema，而上游可能给的是任意
 * JSON Schema（含非 object 的顶层类型）。这里做保守归一：能确认是 object
 * schema 就原样透传，否则包一层空 object，保证 agent 侧拿到的一定合法。
 */
export function toToolInputSchema(schema: unknown): ToolInputSchema {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const record = schema as Record<string, unknown>
    const properties = record['properties']
    const required = record['required']
    const isObjectSchema = record['type'] === 'object' || properties !== undefined

    if (!isObjectSchema) {
      return { ...record, type: 'object', properties: {} }
    }

    return {
      ...record,
      type: 'object',
      properties:
        properties && typeof properties === 'object' && !Array.isArray(properties)
          ? (properties as Record<string, JSONValue>)
          : undefined,
      required: Array.isArray(required) ? (required as string[]) : undefined,
    }
  }
  return { type: 'object', properties: {} }
}

/** 去掉 `serverId__` 前缀，取回原始工具名 */
export function stripPrefix(exposedName: string, serverId: string): string {
  const head = `${serverId}${MCP_NS_SEPARATOR}`
  return exposedName.startsWith(head) ? exposedName.slice(head.length) : exposedName
}

export class SessionManager {
  private readonly pool: UpstreamPool
  private readonly registry: ToolRegistry
  private readonly bus: EventBus

  constructor(pool: UpstreamPool, registry: ToolRegistry, bus: EventBus) {
    this.pool = pool
    this.registry = registry
    this.bus = bus
  }

  /**
   * 计算某个粒度下的工具视图。
   *
   * registry 的全局工具集（带前缀）由配置变更时重建；这里只做**视图过滤与改名**，
   * 不触碰 registry 的路由表。
   */
  buildView(selection: McpSelection, profiles: McpProfile[]): McpView {
    const { ids, prefixed } = resolveServerIds(selection, profiles)
    const all = this.registry.list()

    const allowed = ids.length === 0 ? null : new Set(ids)
    const outwardToExposed = new Map<string, string>()
    const tools: ViewTool[] = []

    for (const tool of all as ExposedTool[]) {
      if (allowed && !allowed.has(tool.serverId)) continue

      const outward = prefixed ? tool.name : stripPrefix(tool.name, tool.serverId)
      if (outwardToExposed.has(outward)) {
        // 单 server 视图下理论上不会冲突；真冲突时加序号兜底
        let seq = 2
        let candidate = `${outward}_${seq}`
        while (outwardToExposed.has(candidate)) {
          seq += 1
          candidate = `${outward}_${seq}`
        }
        outwardToExposed.set(candidate, tool.name)
        tools.push({
          name: candidate,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })
        continue
      }

      outwardToExposed.set(outward, tool.name)
      tools.push({ name: outward, description: tool.description, inputSchema: tool.inputSchema })
    }

    return { selection, tools, outwardToExposed }
  }

  /**
   * 创建一个承载该视图的 MCP Server 实例。
   *
   * v2 的 `createMcpHandler` 是 per-request factory：每个请求建一个 Server，
   * 工具清单来自共享的 registry，因此这里不做任何缓存。
   */
  createServer(view: McpView, sessionId?: string): Server {
    const server = new Server(
      { name: 'agent-compose', version: '0.1.0' },
      { capabilities: { tools: {} } },
    )

    server.setRequestHandler('tools/list', async () => ({
      tools: view.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toToolInputSchema(tool.inputSchema),
      })),
    }))

    server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
      const name = request.params.name
      const args = request.params.arguments as Record<string, unknown> | undefined
      const exposed = view.outwardToExposed.get(name)

      if (!exposed) {
        return {
          isError: true,
          content: [{ type: 'text', text: `未知工具：${name}` }],
        }
      }

      const route = this.registry.resolve(exposed)
      const started = Date.now()
      try {
        const result = await this.registry.callTool(exposed, args)
        this.bus.recordCallLog({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: new Date().toISOString(),
          sessionId,
          serverId: route?.serverId ?? 'unknown',
          toolName: route?.toolName ?? name,
          durationMs: Date.now() - started,
          ok: true,
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.bus.recordCallLog({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: new Date().toISOString(),
          sessionId,
          serverId: route?.serverId ?? 'unknown',
          toolName: route?.toolName ?? name,
          durationMs: Date.now() - started,
          ok: false,
          error: message,
        })
        // 上游失败降级为工具级错误，不抛协议级错误，agent 会话不崩
        return {
          isError: true,
          content: [{ type: 'text', text: `上游调用失败：${message}` }],
        }
      }
    })

    return server
  }

  /** 触发一次上游连接（供「测试连接」用） */
  async probe(serverId: string): Promise<{ ok: boolean; toolCount: number; error?: string }> {
    try {
      await this.pool.ensureConnected(serverId)
      const tools = this.pool.getTools(serverId)
      return { ok: true, toolCount: tools.length }
    } catch (error) {
      return {
        ok: false,
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
