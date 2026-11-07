import type { Component } from 'vue'
import { Braces, Database, Figma, FolderOpen, Globe, MessageSquare } from 'lucide-vue-next'

export type McpService = {
  id: string
  name: string
  description: string
  icon: Component
  /** 图标底色 */
  iconBg: string
  /** 图标颜色 */
  iconColor: string
}

/** 可绑定的 MCP 服务 */
export const mcpServices: McpService[] = [
  {
    id: 'file-system',
    name: 'File System',
    description: '让智能体安全访问指定目录中的文件与资源',
    icon: FolderOpen,
    iconBg: '#FFFBEB',
    iconColor: '#B45309',
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    description: '连接数据库并执行受控的查询和存储操作',
    icon: Database,
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: '搜索代码仓库、管理 Issue 并读取 Pull Request',
    icon: Braces,
    iconBg: '#F1F5F9',
    iconColor: '#475569',
  },
  {
    id: 'figma',
    name: 'Figma',
    description: '读取设计文档、组件信息与设计变量',
    icon: Figma,
    iconBg: '#FFF1F2',
    iconColor: '#BE123C',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: '检索频道消息并向指定会话发送通知',
    icon: MessageSquare,
    iconBg: '#F0EBFF',
    iconColor: '#7354D2',
  },
  {
    id: 'browser-tools',
    name: 'Browser Tools',
    description: '访问网页并截图查看并执行自动化任务',
    icon: Globe,
    iconBg: '#ECFDF5',
    iconColor: '#047857',
  },
]
