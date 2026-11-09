/**
 * MCP 管理页的 Tauri command 封装。
 *
 * Rust 侧尚未实现 MCP_COMMANDS 里的 command，所以每个封装都带降级：
 * invoke 失败时回落到本模块的 mock 数据，纯前端环境下页面也能正常渲染。
 * command 名一律取自 MCP_COMMANDS，不在此处硬编码字符串。
 */
import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'
import {
  MCP_COMMANDS,
  defaultExposure,
  toolKey,
  type McpExposure,
  type McpProfile,
  type McpRuntimeStatus,
  type McpServerDef,
  type McpToolInfo,
  type McpTransportKind,
  type McpUpstreamState,
  type McpUpstreamStatus,
} from '@remote/agent-compose-mcp/types'
import { mcpServices } from '@/data/mcps'

/** 降级标记：为 true 表示当前所有数据来自 mock（Rust command 尚未就绪） */
export const mcpDegraded = ref(false)

const MOCK_ENDPOINT = 'http://127.0.0.1:7801'
const MOCK_TOKEN = 'mcp_mock_7f3a91c4'
const MOCK_PORT = 7801

/** mock 环境下每个上游 server 暴露的工具 */
const MOCK_TOOLS: Record<string, { name: string; description: string }[]> = {
  'file-system': [
    { name: 'read_file', description: '读取指定路径的文件内容' },
    { name: 'write_file', description: '写入文件到指定路径' },
    { name: 'list_directory', description: '列出目录下的条目' },
  ],
  postgresql: [
    { name: 'query', description: '执行只读 SQL 查询' },
    { name: 'list_tables', description: '列出数据库中的表' },
  ],
  github: [
    { name: 'search_code', description: '在代码仓库中搜索' },
    { name: 'list_issues', description: '列出仓库 Issue' },
    { name: 'read_pull_request', description: '读取 Pull Request 内容' },
  ],
  figma: [
    { name: 'get_file', description: '读取设计文档节点' },
    { name: 'get_components', description: '读取组件与样式信息' },
  ],
  slack: [
    { name: 'search_messages', description: '检索频道消息' },
    { name: 'send_message', description: '向会话发送消息' },
  ],
  'browser-tools': [
    { name: 'fetch_page', description: '抓取网页正文' },
    { name: 'screenshot', description: '对页面截图' },
  ],
}

type MockState = {
  servers: McpServerDef[]
  exposure: McpExposure
  profiles: McpProfile[]
}

function buildMockServers(): McpServerDef[] {
  return mcpServices.map((service, index) => {
    const transport: McpTransportKind = index % 2 === 0 ? 'stdio' : 'http'
    const server: McpServerDef = {
      id: service.id,
      name: service.name,
      transport,
      enabled: index < 4,
    }
    if (transport === 'stdio') {
      server.command = 'npx'
      server.args = ['-y', `@modelcontextprotocol/server-${service.id}`]
      server.env = { API_KEY: '${ENV:SERVICE_API_KEY}' }
    } else {
      server.url = `https://mcp.example.com/${service.id}`
      server.headers = { Authorization: 'Bearer ${ENV:SERVICE_TOKEN}' }
    }
    return server
  })
}

function mockToolsOf(serverId: string): McpToolInfo[] {
  return (MOCK_TOOLS[serverId] ?? []).map((tool) => ({
    serverId,
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', properties: {} },
  }))
}

function buildMockExposure(servers: McpServerDef[]): McpExposure {
  const exposure = defaultExposure()
  const picked = servers.filter((server) => server.enabled).slice(0, 2)
  exposure.serverIds = picked.map((server) => server.id)
  exposure.toolKeys = picked.flatMap((server) =>
    mockToolsOf(server.id)
      .slice(0, 2)
      .map((tool) => toolKey(server.id, tool.name)),
  )
  return exposure
}

function buildMockUpstreams(servers: McpServerDef[]): McpUpstreamStatus[] {
  const enabled = servers.filter((server) => server.enabled)
  return servers.map((server) => {
    const rank = enabled.findIndex((item) => item.id === server.id)
    const state: McpUpstreamState = !server.enabled
      ? 'disabled'
      : rank === 2
        ? 'error'
        : rank >= 0
          ? 'ready'
          : 'disconnected'
    const upstream: McpUpstreamStatus = {
      serverId: server.id,
      state,
      tools: state === 'ready' ? mockToolsOf(server.id) : [],
      reconnectAttempt: 0,
    }
    if (state === 'error') {
      upstream.error = '握手失败：上游返回 401（令牌无效）'
    }
    if (state === 'ready') {
      upstream.lastConnectedAt = new Date(Date.now() - 60_000).toISOString()
    }
    return upstream
  })
}

const mockState: MockState = (() => {
  const servers = buildMockServers()
  return {
    servers,
    exposure: buildMockExposure(servers),
    profiles: [
      { id: 'default', name: '默认组合', serverIds: servers.slice(0, 2).map((s) => s.id) },
    ],
  }
})()

function mockStatus(): McpRuntimeStatus {
  return {
    endpoint: MOCK_ENDPOINT,
    token: MOCK_TOKEN,
    port: MOCK_PORT,
    sessions: 2,
    upstreams: buildMockUpstreams(mockState.servers),
    exposure: mockState.exposure,
    profiles: mockState.profiles,
  }
}

function degrade(error: unknown, command: string): void {
  mcpDegraded.value = true
  console.warn(`[mcp] ${command} 不可用，回退到 mock 数据`, error)
}

function cloneServers(servers: McpServerDef[]): McpServerDef[] {
  return servers.map((server) => ({ ...server }))
}

/** 上游 MCP server 列表 */
export async function listServers(): Promise<McpServerDef[]> {
  try {
    const servers = await invoke<McpServerDef[]>(MCP_COMMANDS.listServers)
    mcpDegraded.value = false
    return servers
  } catch (error) {
    degrade(error, MCP_COMMANDS.listServers)
    return cloneServers(mockState.servers)
  }
}

/** 全量保存上游 MCP server 列表 */
export async function saveServers(defs: McpServerDef[]): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.saveServers, { servers: defs })
    mcpDegraded.value = false
  } catch (error) {
    degrade(error, MCP_COMMANDS.saveServers)
    mockState.servers = cloneServers(defs)
  }
}

/** 删除单个上游 MCP server */
export async function removeServer(id: string): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.removeServer, { id })
    mcpDegraded.value = false
  } catch (error) {
    degrade(error, MCP_COMMANDS.removeServer)
    mockState.servers = mockState.servers.filter((server) => server.id !== id)
    mockState.exposure = {
      ...mockState.exposure,
      serverIds: mockState.exposure.serverIds.filter((serverId) => serverId !== id),
      toolKeys: mockState.exposure.toolKeys.filter((key) => !key.startsWith(`${id}::`)),
    }
  }
}

/** 测试单个 server 的连接，返回其最新状态 */
export async function testServer(id: string): Promise<McpUpstreamStatus | null> {
  try {
    const upstream = await invoke<McpUpstreamStatus>(MCP_COMMANDS.testServer, { id })
    mcpDegraded.value = false
    return upstream
  } catch (error) {
    degrade(error, MCP_COMMANDS.testServer)
    const server = mockState.servers.find((item) => item.id === id)
    if (!server) return null
    const state: McpUpstreamState = server.enabled ? 'ready' : 'disabled'
    return {
      serverId: id,
      state,
      tools: state === 'ready' ? mockToolsOf(id) : [],
      reconnectAttempt: 0,
      lastConnectedAt: state === 'ready' ? new Date().toISOString() : undefined,
    }
  }
}

/** 读取对外暴露配置 */
export async function getExposure(): Promise<McpExposure> {
  try {
    const exposure = await invoke<McpExposure>(MCP_COMMANDS.getExposure)
    mcpDegraded.value = false
    return exposure
  } catch (error) {
    degrade(error, MCP_COMMANDS.getExposure)
    return { ...mockState.exposure, toolKeys: [...mockState.exposure.toolKeys] }
  }
}

/** 保存对外暴露配置 */
export async function setExposure(exposure: McpExposure): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.setExposure, { exposure })
    mcpDegraded.value = false
  } catch (error) {
    degrade(error, MCP_COMMANDS.setExposure)
    mockState.exposure = {
      ...exposure,
      serverIds: [...exposure.serverIds],
      toolKeys: [...exposure.toolKeys],
    }
  }
}

/** 读取命名组合（profile）列表 */
export async function listProfiles(): Promise<McpProfile[]> {
  try {
    const profiles = await invoke<McpProfile[]>(MCP_COMMANDS.listProfiles)
    mcpDegraded.value = false
    return profiles
  } catch (error) {
    degrade(error, MCP_COMMANDS.listProfiles)
    return mockState.profiles.map((profile) => ({ ...profile, serverIds: [...profile.serverIds] }))
  }
}

/** 保存命名组合（profile）列表 */
export async function saveProfiles(profiles: McpProfile[]): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.saveProfiles, { profiles })
    mcpDegraded.value = false
  } catch (error) {
    degrade(error, MCP_COMMANDS.saveProfiles)
    mockState.profiles = profiles.map((profile) => ({
      ...profile,
      serverIds: [...profile.serverIds],
    }))
  }
}

/** 读取运行时总状态（endpoint / token / session / 上游状态） */
export async function getStatus(): Promise<McpRuntimeStatus> {
  try {
    const status = await invoke<McpRuntimeStatus>(MCP_COMMANDS.getStatus)
    mcpDegraded.value = false
    return status
  } catch (error) {
    degrade(error, MCP_COMMANDS.getStatus)
    return mockStatus()
  }
}
