import type { Component } from 'vue'
import {
  Bot,
  Code2,
  Database,
  FileText,
  Globe2,
  Image,
  Languages,
  Mail,
  Sparkles,
  Terminal,
} from 'lucide-vue-next'

export type AvatarColor = {
  /** 头像底色 */
  bg: string
  /** 头像内字形颜色 */
  fg: string
}

export type SkillCategory =
  '知识处理' | '代码工程' | '数据分析' | '内容生成' | '运维排障' | '团队协作'

export type Skill = {
  name: string
  description: string
  /** 能力分类，用于详情页 */
  category: SkillCategory
  /** 使用该 Skill 的智能体数量文案 */
  users: string
  /** 头像堆叠中最多展示 2 个，第 3 位用溢出徽标展示剩余数量 */
  avatars: [AvatarColor, AvatarColor]
  /** 溢出徽标数字，无溢出时为 null */
  overflow: number | null
  updated: string
  icon: Component
  /** 图标底色 */
  iconBg: string
  /** 图标描边色 */
  iconColor: string
  enabled: boolean
}

export const skills: Skill[] = [
  {
    name: '知识库检索',
    category: '知识处理',
    description: '从企业知识库中检索、总结并引用准确的信息',
    users: '3 个 agents',
    avatars: [
      { bg: '#E7F6F1', fg: '#167D69' },
      { bg: '#EDF1FF', fg: '#526ED8' },
    ],
    overflow: 1,
    updated: '2026-11-06 14:50:32',
    icon: Database,
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
    enabled: true,
  },
  {
    name: '代码解释器',
    category: '代码工程',
    description: '运行 Python 代码，完成数据分析与复杂计算任务',
    users: '4 个 agents',
    avatars: [
      { bg: '#EDF1FF', fg: '#526ED8' },
      { bg: '#292D35', fg: '#F1F2F4' },
    ],
    overflow: 2,
    updated: '2026-11-05 14:49:55',
    icon: Code2,
    iconBg: '#EFF6FF',
    iconColor: '#2563EB',
    enabled: true,
  },
  {
    name: 'SQL 查询助手',
    category: '数据分析',
    description: '理解自然语言并生成安全、可执行的 SQL 查询',
    users: '5 个 agents',
    avatars: [
      { bg: '#292D35', fg: '#F1F2F4' },
      { bg: '#FFF0E8', fg: '#D97745' },
    ],
    overflow: 3,
    updated: '2026-11-04 14:49:18',
    icon: Database,
    iconBg: '#ECFDF5',
    iconColor: '#047857',
    enabled: true,
  },
  {
    name: '图像理解',
    category: '知识处理',
    description: '识别图片内容，提取文字并分析视觉信息',
    users: '6 个 agents',
    avatars: [
      { bg: '#FFF0E8', fg: '#D97745' },
      { bg: '#E7F6F1', fg: '#167D69' },
    ],
    overflow: 4,
    updated: '2026-11-03 14:48:41',
    icon: Image,
    iconBg: '#FFFBEB',
    iconColor: '#B45309',
    enabled: true,
  },
  {
    name: '网页内容提取',
    category: '知识处理',
    description: '读取指定网页并提取结构化正文与关键信息',
    users: '7 个 agents',
    avatars: [
      { bg: '#E7F6F1', fg: '#167D69' },
      { bg: '#EDF1FF', fg: '#526ED8' },
    ],
    overflow: 5,
    updated: '2026-11-02 14:48:04',
    icon: Globe2,
    iconBg: '#F1F5F9',
    iconColor: '#475569',
    enabled: false,
  },
  {
    name: '文件解析',
    category: '知识处理',
    description: '解析 PDF、Word、Excel 等常见办公文档',
    users: '2 个 agents',
    avatars: [
      { bg: '#EDF1FF', fg: '#526ED8' },
      { bg: '#292D35', fg: '#F1F2F4' },
    ],
    overflow: null,
    updated: '2026-11-01 14:47:27',
    icon: FileText,
    iconBg: '#FFF1F2',
    iconColor: '#BE123C',
    enabled: true,
  },
  {
    name: '会议纪要生成',
    category: '内容生成',
    description: '整理会议录音与文字记录，提取决策和待办事项',
    users: '3 个 agents',
    avatars: [
      { bg: '#292D35', fg: '#F1F2F4' },
      { bg: '#FFF0E8', fg: '#D97745' },
    ],
    overflow: 1,
    updated: '2026-10-31 14:46:50',
    icon: FileText,
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
    enabled: true,
  },
  {
    name: '数据可视化',
    category: '数据分析',
    description: '根据结构化数据自动生成图表与分析摘要',
    users: '4 个 agents',
    avatars: [
      { bg: '#FFF0E8', fg: '#D97745' },
      { bg: '#E7F6F1', fg: '#167D69' },
    ],
    overflow: 2,
    updated: '2026-10-30 14:46:13',
    icon: Sparkles,
    iconBg: '#EFF6FF',
    iconColor: '#2563EB',
    enabled: true,
  },
  {
    name: '邮件撰写助手',
    category: '内容生成',
    description: '根据沟通目标生成专业、清晰的商务邮件',
    users: '5 个 agents',
    avatars: [
      { bg: '#E7F6F1', fg: '#167D69' },
      { bg: '#EDF1FF', fg: '#526ED8' },
    ],
    overflow: 3,
    updated: '2026-10-29 14:45:36',
    icon: Mail,
    iconBg: '#ECFDF5',
    iconColor: '#047857',
    enabled: false,
  },
  {
    name: '多语言翻译',
    category: '内容生成',
    description: '翻译多种语言并保留原文语气和专业术语',
    users: '6 个 agents',
    avatars: [
      { bg: '#EDF1FF', fg: '#526ED8' },
      { bg: '#292D35', fg: '#F1F2F4' },
    ],
    overflow: 4,
    updated: '2026-10-28 14:44:59',
    icon: Languages,
    iconBg: '#FFFBEB',
    iconColor: '#B45309',
    enabled: true,
  },
  {
    name: '合同条款审查',
    category: '知识处理',
    description: '识别合同中的风险条款并给出修改建议',
    users: '7 个 agents',
    avatars: [
      { bg: '#E7F6F1', fg: '#167D69' },
      { bg: '#EDF1FF', fg: '#526ED8' },
    ],
    overflow: 5,
    updated: '2026-10-27 14:44:22',
    icon: FileText,
    iconBg: '#F1F5F9',
    iconColor: '#475569',
    enabled: true,
  },
  {
    name: '接口文档生成',
    category: '代码工程',
    description: '读取代码与接口定义并生成标准 API 文档',
    users: '2 个 agents',
    avatars: [
      { bg: '#EDF1FF', fg: '#526ED8' },
      { bg: '#292D35', fg: '#F1F2F4' },
    ],
    overflow: null,
    updated: '2026-10-26 14:43:45',
    icon: Code2,
    iconBg: '#FFF1F2',
    iconColor: '#BE123C',
    enabled: true,
  },
  {
    name: '舆情趋势分析',
    category: '数据分析',
    description: '汇总公开信息并分析话题热度与情绪变化',
    users: '3 个 agents',
    avatars: [
      { bg: '#292D35', fg: '#F1F2F4' },
      { bg: '#FFF0E8', fg: '#D97745' },
    ],
    overflow: 1,
    updated: '2026-10-25 14:43:08',
    icon: Sparkles,
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
    enabled: false,
  },
  {
    name: '产品需求拆解',
    category: '团队协作',
    description: '将产品目标拆分为用户故事、任务和验收标准',
    users: '4 个 agents',
    avatars: [
      { bg: '#FFF0E8', fg: '#D97745' },
      { bg: '#E7F6F1', fg: '#167D69' },
    ],
    overflow: 2,
    updated: '2026-10-24 14:42:31',
    icon: Bot,
    iconBg: '#EFF6FF',
    iconColor: '#2563EB',
    enabled: true,
  },
  {
    name: '日志异常诊断',
    category: '运维排障',
    description: '分析应用日志并定位潜在异常原因和影响范围',
    users: '5 个 agents',
    avatars: [
      { bg: '#E7F6F1', fg: '#167D69' },
      { bg: '#EDF1FF', fg: '#526ED8' },
    ],
    overflow: 3,
    updated: '2026-10-23 14:41:54',
    icon: Terminal,
    iconBg: '#ECFDF5',
    iconColor: '#047857',
    enabled: true,
  },
  {
    name: '客户反馈归类',
    category: '团队协作',
    description: '自动聚类客户反馈并提炼高频问题与改进方向',
    users: '6 个 agents',
    avatars: [
      { bg: '#EDF1FF', fg: '#526ED8' },
      { bg: '#292D35', fg: '#F1F2F4' },
    ],
    overflow: 4,
    updated: '2026-10-22 14:41:17',
    icon: Bot,
    iconBg: '#FFFBEB',
    iconColor: '#B45309',
    enabled: true,
  },
  {
    name: '图片素材标注',
    category: '内容生成',
    description: '批量识别图片内容并生成可检索的标签信息',
    users: '7 个 agents',
    avatars: [
      { bg: '#292D35', fg: '#F1F2F4' },
      { bg: '#FFF0E8', fg: '#D97745' },
    ],
    overflow: 5,
    updated: '2026-10-21 14:40:40',
    icon: Image,
    iconBg: '#F1F5F9',
    iconColor: '#475569',
    enabled: false,
  },
  {
    name: '周报自动汇总',
    category: '团队协作',
    description: '聚合团队工作记录并生成结构化项目周报',
    users: '2 个 agents',
    avatars: [
      { bg: '#FFF0E8', fg: '#D97745' },
      { bg: '#E7F6F1', fg: '#167D69' },
    ],
    overflow: null,
    updated: '2026-10-20 14:40:03',
    icon: FileText,
    iconBg: '#FFF1F2',
    iconColor: '#BE123C',
    enabled: true,
  },
  {
    name: '测试用例生成',
    category: '代码工程',
    description: '根据需求和代码变更生成覆盖关键路径的测试用例',
    users: '3 个 agents',
    avatars: [
      { bg: '#E7F6F1', fg: '#167D69' },
      { bg: '#EDF1FF', fg: '#526ED8' },
    ],
    overflow: 1,
    updated: '2026-10-19 14:39:26',
    icon: Code2,
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
    enabled: true,
  },
  {
    name: '竞品信息整理',
    category: '数据分析',
    description: '收集公开竞品信息并输出结构化对比报告',
    users: '4 个 agents',
    avatars: [
      { bg: '#EDF1FF', fg: '#526ED8' },
      { bg: '#292D35', fg: '#F1F2F4' },
    ],
    overflow: 2,
    updated: '2026-10-18 14:38:49',
    icon: Globe2,
    iconBg: '#EFF6FF',
    iconColor: '#2563EB',
    enabled: true,
  },
]

/** 详情抽屉里展示的能力元信息 */
export type SkillDetail = {
  /** 能力类型，固定为 Agent Skill */
  type: 'Agent Skill'
  /** 运行状态：跟随 enabled */
  status: '运行中' | '已停用'
  /** 权限范围 */
  scope: string
  /** 最近更新（短格式） */
  lastUpdated: string
  /** 过去 12 天的调用量 */
  calls: number[]
  /** 过去 12 天调用总量 */
  callsTotal: number
}

/** 按名称做稳定散列，生成可复现的调用趋势（不引入随机数） */
const hashName = (name: string): number => {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return hash
}

/** 生成过去 12 天的调用量序列 */
const buildCalls = (name: string): number[] => {
  const seed = hashName(name)
  return Array.from({ length: 12 }, (_, index) => {
    const value = (seed >> (index % 12)) & 0xff
    return 18 + (value % 76)
  })
}

/** 把 skill 的更新时间戳转成「11-06 14:50」这样的短格式 */
const shortUpdated = (updated: string): string => {
  const [date, time] = updated.split(' ')
  const [, month, day] = date.split('-')
  return `${month}-${day} ${time.slice(0, 5)}`
}

/** 取某个 skill 的详情元信息 */
export const detailOf = (skill: Skill): SkillDetail => {
  const calls = buildCalls(skill.name)
  return {
    type: 'Agent Skill',
    status: skill.enabled ? '运行中' : '已停用',
    scope: '当前工作区',
    lastUpdated: shortUpdated(skill.updated),
    calls,
    callsTotal: calls.reduce((sum, value) => sum + value, 0),
  }
}
