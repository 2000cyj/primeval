import { cliAgents } from '@/data/agents'

export type Harness = {
  id: string
  /** harness 名称，如 Claude */
  name: string
  /** 版本号 */
  version: string
  /** 品牌图标 */
  icon: string
  /** 图标底色 */
  iconBg: string
}

/**
 * 可作为运行目标的智能体（agent）列表。
 * 直接来自 agent 列表数据（本地 CLI）。
 */
export const harnesses: Harness[] = cliAgents.map((agent) => ({
  id: agent.id,
  name: agent.name,
  version: agent.version,
  icon: agent.icon,
  iconBg: agent.iconBg,
}))
