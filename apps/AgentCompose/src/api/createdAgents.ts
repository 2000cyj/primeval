import { invoke } from '@tauri-apps/api/core'
import type { CreatedAgent } from '@/data/createdAgents'

/**
 * 已创建智能体的落盘接口。
 *
 * 落盘布局（Rust 侧 `agent_store.rs`）：
 * - `~/.agent-compose/agents/<id>/agent.json` —— 列表数据
 * - `~/.agent-compose/agents/<id>/AGENTS.md` —— 指令正文
 */
const COMMANDS = {
  list: 'created_agents_list',
  save: 'created_agents_save',
  delete: 'created_agents_delete',
} as const

/** 统一的错误包装：保留原始原因，便于界面直接展示 */
function fail(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${action}失败：${detail}`, { cause: error })
}

/** 列出全部智能体（新的在前） */
export async function listCreatedAgents(): Promise<CreatedAgent[]> {
  try {
    return await invoke<CreatedAgent[]>(COMMANDS.list)
  } catch (error) {
    throw fail('读取智能体', error)
  }
}

/** 新建或更新一个智能体 */
export async function saveCreatedAgent(agent: CreatedAgent): Promise<CreatedAgent> {
  try {
    return await invoke<CreatedAgent>(COMMANDS.save, { agent })
  } catch (error) {
    throw fail('保存智能体', error)
  }
}

/** 删掉一个智能体 */
export async function deleteCreatedAgent(id: string): Promise<void> {
  try {
    await invoke(COMMANDS.delete, { id })
  } catch (error) {
    throw fail('删除智能体', error)
  }
}
