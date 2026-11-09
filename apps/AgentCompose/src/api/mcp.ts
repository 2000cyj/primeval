/**
 * MCP 管理页的 Tauri command 封装。
 *
 * command 名一律取自 MCP_COMMANDS，不在此处硬编码字符串。
 *
 * **不做 mock 降级**：sidecar 不可用时直接抛错，让界面显示真实原因。
 * 假数据会让人以为配置已经生效，实际什么都没存 —— 那比报错更糟。
 */
import { invoke } from '@tauri-apps/api/core'
import {
  MCP_COMMANDS,
  defaultExposure,
  toolKey,
  type McpExposure,
  type McpProfile,
  type McpRuntimeStatus,
  type McpServerDef,
  type McpToolInfo,
  type McpUpstreamStatus,
} from '@remote/agent-compose-mcp/types'

/** 统一的错误包装：保留原始原因，便于界面直接展示 */
function fail(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${action}失败：${detail}`, { cause: error })
}

/**
 * 确保 MCP sidecar 在运行。
 *
 * sidecar 是独立进程，GUI 启动时可能还没拉起。先请求 Rust 侧拉起并等待
 * 就绪，否则后续 admin 调用会全部失败。
 */
export async function ensureSidecar(): Promise<boolean> {
  try {
    const status = await invoke<{ running: boolean }>(MCP_COMMANDS.ensureSidecar)
    return status.running
  } catch (error) {
    throw fail('启动 MCP sidecar', error)
  }
}

/** 上游 MCP server 列表 */
export async function listServers(): Promise<McpServerDef[]> {
  try {
    return await invoke<McpServerDef[]>(MCP_COMMANDS.listServers)
  } catch (error) {
    throw fail('读取上游列表', error)
  }
}

/** 全量保存上游 MCP server 列表 */
export async function saveServers(defs: McpServerDef[]): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.saveServers, { servers: defs })
  } catch (error) {
    throw fail('保存上游列表', error)
  }
}

/** 删除单个上游 MCP server */
export async function removeServer(id: string): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.removeServer, { id })
  } catch (error) {
    throw fail('删除上游', error)
  }
}

/** 测试单个 server 的连接，返回其最新状态 */
export async function testServer(id: string): Promise<McpUpstreamStatus | null> {
  try {
    return await invoke<McpUpstreamStatus>(MCP_COMMANDS.testServer, { id })
  } catch (error) {
    throw fail('测试连接', error)
  }
}

/** 读取对外暴露配置 */
export async function getExposure(): Promise<McpExposure> {
  try {
    return await invoke<McpExposure>(MCP_COMMANDS.getExposure)
  } catch (error) {
    throw fail('读取暴露配置', error)
  }
}

/** 保存对外暴露配置 */
export async function setExposure(exposure: McpExposure): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.setExposure, { exposure })
  } catch (error) {
    throw fail('保存暴露配置', error)
  }
}

/** 读取命名组合（profile）列表 */
export async function listProfiles(): Promise<McpProfile[]> {
  try {
    return await invoke<McpProfile[]>(MCP_COMMANDS.listProfiles)
  } catch (error) {
    throw fail('读取组合列表', error)
  }
}

/** 保存命名组合（profile）列表 */
export async function saveProfiles(profiles: McpProfile[]): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.saveProfiles, { profiles })
  } catch (error) {
    throw fail('保存组合列表', error)
  }
}

/** 读取运行时总状态（endpoint / token / session / 上游状态） */
export async function getStatus(): Promise<McpRuntimeStatus> {
  try {
    return await invoke<McpRuntimeStatus>(MCP_COMMANDS.getStatus)
  } catch (error) {
    throw fail('读取运行时状态', error)
  }
}

/**
 * 在官方目录里搜索第三方 mcp server。
 *
 * 读操作，失败时抛错 —— 假目录会误导用户。
 */
export async function searchRegistry(
  query: string,
  cursor?: string,
): Promise<import('@remote/agent-compose-mcp/types').McpRegistrySearchResult> {
  try {
    return await invoke<import('@remote/agent-compose-mcp/types').McpRegistrySearchResult>(
      MCP_COMMANDS.searchRegistry,
      { query, cursor },
    )
  } catch (error) {
    throw fail('目录搜索', error)
  }
}

/**
 * 发起 oauth 授权，返回需要用户打开的授权地址。
 *
 * 写操作语义：拿不到授权地址时直接抛错，否则用户会看到一个打不开的
 * 链接，却以为授权已经发起。
 */
export async function authorizeServer(
  id: string,
): Promise<{ authorizeUrl: string; state: string }> {
  try {
    return await invoke<{ authorizeUrl: string; state: string }>(MCP_COMMANDS.authorizeServer, {
      id,
    })
  } catch (error) {
    throw fail('发起授权', error)
  }
}

/**
 * 用系统默认浏览器打开网址。
 *
 * 授权流程需要用户在浏览器里人工登录与同意，桌面端不能自己弹浏览器，
 * 交给系统默认浏览器最可靠。
 */
export async function openUrl(url: string): Promise<void> {
  try {
    await invoke(MCP_COMMANDS.openUrl, { url })
  } catch (error) {
    throw fail('打开浏览器', error)
  }
}

/**
 * 取目录条目对应的上游定义。
 *
 * 条目既没有可本地启动的包、也没有远程端点时返回 null（不可一键添加）。
 */
export function registryServerDef(
  entry: import('@remote/agent-compose-mcp/types').McpRegistryEntry,
): McpServerDef | null {
  return entry.def ?? null
}

/** 目录条目里是否带可用的工具白名单键 */
export function registryToolKeys(
  entry: import('@remote/agent-compose-mcp/types').McpRegistryEntry,
  tools: McpToolInfo[],
): string[] {
  return tools.map((tool) => toolKey(entry.name, tool.name))
}

/** 默认暴露配置（界面初始化用，避免各处分叉） */
export { defaultExposure }
