import type { Component } from 'vue'
import { Bot, MousePointer2, Sparkle, Sun } from 'lucide-vue-next'

export type CliStatus = 'available' | 'login-required'

export type CliAgent = {
  id: string
  /** 智能体名称 */
  name: string
  /** 已绑定 skills 数量 */
  skillsCount: number
  /** 本地可执行文件路径 */
  path: string
  /** 当前版本 */
  version: string
  /** 最新版本（有值时显示升级入口） */
  latestVersion?: string
  /** 是否存在其它安装位置 */
  extraInstall?: string
  status: CliStatus
  icon: Component
  /** 图标底色 */
  iconBg: string
  /** 图标颜色 */
  iconColor: string
}

/** 本地 CLI（智能体）列表 */
export const cliAgents: CliAgent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    skillsCount: 6,
    path: 'D:\\nodejs\\claude.cmd',
    version: '2.1.311',
    latestVersion: '2.1.318',
    extraInstall: '另有 1 处安装',
    status: 'available',
    icon: Sun,
    iconBg: '#FFF0E8',
    iconColor: '#DC7835',
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    skillsCount: 6,
    path: '/opt/homebrew/bin/codex',
    version: 'v0.8.0',
    status: 'available',
    icon: Bot,
    iconBg: '#E7F6F1',
    iconColor: '#167D69',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    skillsCount: 5,
    path: '/usr/local/bin/gemini',
    version: 'v0.1.12',
    status: 'login-required',
    icon: Sparkle,
    iconBg: '#EBF0FF',
    iconColor: '#4F6FDC',
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    skillsCount: 5,
    path: '/Users/lin/.local/bin/cursor-agent',
    version: 'v0.4.2',
    status: 'available',
    icon: MousePointer2,
    iconBg: '#292D35',
    iconColor: '#F1F2F4',
  },
]
