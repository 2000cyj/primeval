/**
 * 工具聚合与命名空间：把多个上游的工具聚合成对外的一份工具集。
 *
 * - 对外工具名 = `{serverId}__{原始工具名}`（types.ts 的 exposedToolName）。
 * - 路由用显式映射表（对外名 → { serverId, 原始工具名 }），
 *   不用字符串切割，因为原始工具名本身可能含双下划线。
 * - 暴露过滤按 McpExposure：serverIds 决定哪些 server 可见（并决定裁剪顺序），
 *   toolKeys（`serverId::原始工具名`）决定哪些工具可见；
 *   超出 maxTools 时按 serverIds 顺序裁剪。
 *   白名单语义：serverIds / toolKeys 为空 = 不暴露任何 server / 工具，需显式勾选。
 * - inputSchema 原样透传（JSON Schema），不转 zod。
 */
import type { CallToolResult } from '@modelcontextprotocol/client'
import type { McpExposure, McpToolInfo } from './types.ts'
import { exposedToolName, toolKey } from './types.ts'
import type { UpstreamPool } from './upstream.ts'

/** 路由：对外工具名指向的上游与原始工具名 */
export type ExposedToolRoute = {
  serverId: string
  /** 原始工具名（不含命名空间前缀） */
  toolName: string
}

/** 对外暴露的工具 */
export type ExposedTool = {
  /** 对外工具名 = `{serverId}__{原始工具名}` */
  name: string
  description?: string
  /** JSON Schema，原样透传 */
  inputSchema: unknown
  serverId: string
  /** 原始工具名 */
  toolName: string
}

/** 一个上游的工具来源 */
export type ExposedToolSource = {
  serverId: string
  /** 上游展示名，用于描述前缀 */
  serverName: string
  tools: McpToolInfo[]
}

/** 描述注入：加上上游名前缀，方便 agent 区分同名工具 */
function withServerPrefix(serverName: string, description?: string): string {
  return description ? `[${serverName}] ${description}` : `[${serverName}]`
}

export class ToolRegistry {
  private readonly pool: UpstreamPool
  /** 对外工具名 → 路由（显式映射表） */
  private routes = new Map<string, ExposedToolRoute>()
  private exposed: ExposedTool[] = []

  constructor(pool: UpstreamPool) {
    this.pool = pool
  }

  /**
   * 按暴露配置聚合对外工具集，并重建路由表。
   *
   * 过滤规则：
   * - server 只取 `exposure.serverIds` 里列出的（顺序即裁剪顺序）；
   * - 工具只取 `exposure.toolKeys` 里列出的（`serverId::原始工具名`）。
   */
  build(exposure: McpExposure, sources: ExposedToolSource[]): ExposedTool[] {
    const routes = new Map<string, ExposedToolRoute>()
    const tools: ExposedTool[] = []
    const allowedTools = new Set(exposure.toolKeys)
    const maxTools = Math.max(0, exposure.maxTools)
    const visitedServers = new Set<string>()

    for (const serverId of exposure.serverIds) {
      if (tools.length >= maxTools) break
      if (visitedServers.has(serverId)) continue
      visitedServers.add(serverId)

      const source = sources.find((item) => item.serverId === serverId)
      if (!source) continue

      for (const tool of source.tools) {
        if (tools.length >= maxTools) break
        if (!allowedTools.has(toolKey(serverId, tool.name))) continue

        const base = exposedToolName(serverId, tool.name)
        let name = base
        let seq = 1
        while (routes.has(name)) {
          name = `${base}_${seq}`
          seq += 1
        }
        routes.set(name, { serverId, toolName: tool.name })

        const exposed: ExposedTool = {
          name,
          description: withServerPrefix(source.serverName, tool.description),
          inputSchema: tool.inputSchema,
          serverId,
          toolName: tool.name,
        }
        tools.push(exposed)
      }
    }

    this.routes = routes
    this.exposed = tools
    return tools
  }

  /**
   * 用连接池里已知的工具清单聚合（工具清单来自各上游最近一次 listTools）。
   */
  buildFromPool(exposure: McpExposure): ExposedTool[] {
    const sources: ExposedToolSource[] = this.pool.getServerDefs().map((def) => ({
      serverId: def.id,
      serverName: def.name,
      tools: this.pool.getTools(def.id),
    }))
    return this.build(exposure, sources)
  }

  /**
   * 当前对外工具集。
   */
  list(): ExposedTool[] {
    return [...this.exposed]
  }

  /**
   * 对外工具名 → 上游路由；未知工具返回 undefined。
   */
  resolve(exposedName: string): ExposedToolRoute | undefined {
    return this.routes.get(exposedName)
  }

  /**
   * 按对外工具名调用上游工具。
   */
  async callTool(exposedName: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    const route = this.routes.get(exposedName)
    if (!route) throw new Error(`未知工具：${exposedName}`)
    return this.pool.callTool(route.serverId, route.toolName, args)
  }
}
