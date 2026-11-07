import { agentIcons } from '@/data/agentIcons'

export type AgentRun = {
  id: string
  /** 实例名称 */
  name: string
  /** 是否在运行 */
  running: boolean
  /** 最近活跃时间 */
  lastActive: string
  /** 运行次数 */
  runs: number
  /** 已绑定的 skills */
  skills: string[]
  /** 品牌图标（svg 资源 URL） */
  icon: string
  /** 图标底色 */
  iconBg: string
}

/** 智能体运行实例（mock 数据） */
export const agentRuns: AgentRun[] = [
  {
    id: 'claude-sonnet-4',
    name: 'claude-sonnet-4',
    running: true,
    lastActive: '2 分钟前',
    runs: 1284,
    skills: ['知识库检索', '代码解释器', '图像理解'],
    icon: agentIcons.claude,
    iconBg: '#FFF0E8',
  },
  {
    id: 'gpt-5-codex',
    name: 'gpt-5-codex',
    running: true,
    lastActive: '11 分钟前',
    runs: 862,
    skills: ['SQL 查询助手', '数据可视化'],
    icon: agentIcons.openai,
    iconBg: '#ECFDF5',
  },
  {
    id: 'gemini-3-pro',
    name: 'gemini-3-pro',
    running: false,
    lastActive: '1 小时前',
    runs: 437,
    skills: ['网页内容提取', '多语言翻译', '会议纪要生成'],
    icon: agentIcons.gemini,
    iconBg: '#EEF2FF',
  },
  {
    id: 'cursor-agent-sonnet',
    name: 'cursor-agent-sonnet',
    running: false,
    lastActive: '昨天 22:14',
    runs: 96,
    skills: ['文件解析'],
    icon: agentIcons.opencode,
    iconBg: '#F1F5F9',
  },
  {
    id: 'local-coder-mini',
    name: 'local-coder-mini',
    running: false,
    lastActive: '3 天前',
    runs: 12,
    skills: [],
    icon: agentIcons.ollama,
    iconBg: '#F1F5F9',
  },
]
