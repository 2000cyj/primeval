/**
 * 智能体 ↔ skill / MCP 的关联方式：**相对路径引用**。
 *
 * 引用格式（都相对 `~/.agent-compose/`）：
 * - skill：`skills/<目录名>`
 * - MCP：`mcp/servers.json#<server id>`
 *
 * 为什么存引用而不是名字 / 绝对路径：
 * 为了**只改一处**。在 Skills 页改了 skill 的名字或描述、在 MCP 页改了
 * server 的名字，智能体这边不用跟着改 —— 展示时按引用现查现用。
 */

/** MCP server 的引用 */
export const mcpServerRef = (id: string): string => `mcp/servers.json#${id}`

/** 从引用里取出 MCP server 的 id */
export const mcpServerIdFromRef = (ref: string): string => ref.split('#')[1] ?? ''

/** 这个引用是不是指向某个 MCP server */
export const isMcpRef = (ref: string): boolean => ref.startsWith('mcp/servers.json#')
