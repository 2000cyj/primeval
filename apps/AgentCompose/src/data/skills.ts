import type { Component } from 'vue'

export type Skill = {
  name: string
  description: string
  /** 能力分类（详情页展示）；真实 skill 用来源代替 */
  category: string
  /** 数据来源：手动创建 / 从本地导入 / 从 URL 导入 / 从运行时复制 / 创建副本 */
  source?: string
  /** 来源的原始值（manual / git / url / …）—— 筛选按它匹配，不按显示文案 */
  sourceKey?: string
  /** 使用该 Skill 的智能体名称（来自「智能体」页的真实绑定） */
  agentNames: string[]
  updated: string
  icon: Component
  /** 图标底色 */
  iconBg: string
  /** 图标描边色 */
  iconColor: string
  enabled: boolean
  /** 是否有可重新拉取的来源（可用于「从来源更新」） */
  refreshable?: boolean
}
