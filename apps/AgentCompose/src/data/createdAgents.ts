/**
 * 已创建的智能体。
 *
 * 「智能体」页展示的就是这些 —— 跟 agents 页的本机 CLI 不是一回事：
 * 那边是装在机器上的工具，这边是用户建的智能体（跑在 Pi 上）。
 *
 * 落盘（Rust 侧 `agent_store.rs`）：
 * - `~/.agent-compose/agents/<id>/agent.json` —— 列表数据
 * - `~/.agent-compose/agents/<id>/AGENTS.md` —— 指令正文
 *
 * 绑定的 skill / MCP 存的是**相对 `~/.agent-compose` 的路径引用**，
 * 不是名字也不是绝对路径 —— 在 Skills / MCP 页改了名字或描述，
 * 智能体这边不用跟着改，展示时按引用现查现用。
 */
import { ref } from 'vue'
import { deleteCreatedAgent, listCreatedAgents, saveCreatedAgent } from '@/api/createdAgents'

export type CreatedAgent = {
  /** 唯一 id（也是目录名） */
  id: string
  /** 名称 */
  name: string
  /** 描述 */
  description: string
  /** 指令（落在 AGENTS.md 里） */
  instruction: string
  /** 绑定的 skills：相对路径引用，如 `skills/knowledge-base` */
  skills: string[]
  /** 绑定的 MCP server：`mcp/servers.json#<id>` */
  mcpServers: string[]
  /** 绑定的 Pi 扩展：相对扩展库的路径，如 `extensions/npm/pi-mcp-adapter` */
  extensions: string[]
  /** 跑在哪个 agent 上（现在只有 `pi`） */
  runtime: string
  /** 配置版本：每次变更 +1（智能体改动 / 它绑的 skill 或 MCP 变了） */
  version: number
  /** 创建时间（epoch 毫秒） */
  createdAt: number
}

/**
 * 新建/修改时的输入：id、创建时间、版本号都不由调用方给。
 *
 * runtime 可省（默认 Pi）—— 调用方不指定时按 Pi 建。
 */
export type CreatedAgentInput = Omit<CreatedAgent, 'id' | 'createdAt' | 'version' | 'runtime'> & {
  runtime?: string
}

const createdAgents = ref<CreatedAgent[]>([])
/** 是否已经从磁盘读过一次 */
const loaded = ref(false)

/** 从磁盘读回全部智能体 */
const load = async (): Promise<void> => {
  try {
    // 后端偶发返回 null 时按空列表处理，不要把 null 存进去
    createdAgents.value = (await listCreatedAgents()) ?? []
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    loaded.value = true
  }
}

/**
 * 生成智能体 id。
 *
 * 只用 `Date.now()` 会撞车：同一毫秒里创建两个智能体就会得到同一个 id，
 * 后一个把前一个盖掉（目录也是同一个）。所以再带一个自增序号和随机后缀。
 */
let idSeq = 0
const nextId = (): string => {
  idSeq += 1
  const random = Math.random().toString(36).slice(2, 6)
  return `agent-${Date.now().toString(36)}-${idSeq.toString(36)}-${random}`
}

/** 新建一个智能体并落盘 */
const add = async (agent: CreatedAgentInput): Promise<CreatedAgent> => {
  const name = agent.name.trim()
  if (hasName(name)) {
    throw new Error(`已经有同名智能体了：${name}`)
  }
  const created = await saveCreatedAgent({
    ...agent,
    name,
    id: nextId(),
    // 运行时：现在只有 Pi。写死在这里，调用方不用每次都带。
    runtime: agent.runtime || 'pi',
    // 版本号由后端统一管（每次保存 +1，新建从 1 开始）
    version: 0,
    createdAt: Date.now(),
  })
  createdAgents.value = [created, ...createdAgents.value]
  return created
}

/** 改一个并落盘 */
const update = async (id: string, patch: Partial<CreatedAgentInput>): Promise<void> => {
  const current = createdAgents.value.find((item) => item.id === id)
  if (!current) throw new Error('智能体不存在')
  // 改名时也不能撞上别的智能体
  if (patch.name !== undefined && hasName(patch.name, id)) {
    throw new Error(`已经有同名智能体了：${patch.name.trim()}`)
  }
  const saved = await saveCreatedAgent({ ...current, ...patch })
  createdAgents.value = createdAgents.value.map((item) => (item.id === id ? saved : item))
}

/**
 * 有没有同名智能体。
 *
 * 名字是智能体的唯一标识（`agentspace run <名称>` 按名字找），所以不允许重名。
 * exceptId：改名时把自己排除掉。
 */
const hasName = (name: string, exceptId?: string): boolean => {
  const target = name.trim()
  if (!target) return false
  return createdAgents.value.some((item) => item.name.trim() === target && item.id !== exceptId)
}

/** 删掉一个 */
const remove = async (id: string): Promise<void> => {
  await deleteCreatedAgent(id)
  createdAgents.value = createdAgents.value.filter((item) => item.id !== id)
}

export const useCreatedAgents = () => ({
  createdAgents,
  loaded,
  load,
  add,
  update,
  remove,
  hasName,
})
