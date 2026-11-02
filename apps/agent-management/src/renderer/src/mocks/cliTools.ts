import type { CliTool } from './types'

// 本地 CLI 扫描元信息（页面展示用，非真实扫描结果；文案对齐实测原型）
export const cliScanMeta = {
  /** 上次扫描完成时间 */
  lastScanAt: '今天 10:42',
  /** 上次扫描耗时 */
  lastDuration: '1.2 秒',
  /** 扫描范围说明 */
  scope: '扫描范围限于当前设备的 PATH 与常用安装目录，不会发现或连接远程智能体。',
  /** 当前设备标识（原型口径：LOCAL DEVICE） */
  device: 'LOCAL DEVICE',
  /** 定时刷新可选间隔 */
  intervals: ['5 分钟', '15 分钟', '30 分钟', '1 小时'],
  defaultInterval: '15 分钟',
}

export const initialCliTools: CliTool[] = [
  {
    id: 'cli-claude-code',
    name: 'Claude Code',
    desc: '本地命令行智能体',
    command: 'claude',
    path: '/usr/local/bin/claude',
    version: 'v1.0.35',
    status: 'ready',
    seen: '2 分钟前',
    icon: 'terminal',
    iconColor: 'violet',
  },
  {
    id: 'cli-codex',
    name: 'OpenAI Codex',
    desc: '本地命令行智能体',
    command: 'codex',
    path: '/opt/homebrew/bin/codex',
    version: 'v0.8.0',
    status: 'ready',
    seen: '2 分钟前',
    icon: 'sparkles',
    iconColor: 'green',
  },
  {
    id: 'cli-gemini',
    name: 'Gemini CLI',
    desc: '本地命令行智能体',
    command: 'gemini',
    path: '/usr/local/bin/gemini',
    version: 'v0.1.12',
    status: 'login',
    seen: '2 分钟前',
    icon: 'bot',
    iconColor: 'blue',
  },
  {
    id: 'cli-cursor',
    name: 'Cursor Agent',
    desc: '本地命令行智能体',
    command: 'cursor-agent',
    path: '~/.local/bin/cursor-agent',
    version: 'v0.4.2',
    status: 'ready',
    seen: '2 分钟前',
    icon: 'cursor',
    iconColor: 'dark',
  },
]
