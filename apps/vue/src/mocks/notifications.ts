import type { NotificationItem } from './types'

export const initialNotifications: NotificationItem[] = [
  {
    id: 'notif-db-recovered',
    title: 'PostgreSQL 已恢复连接',
    body: '服务健康检查已通过，可以正常调用。',
    time: '8 分钟前',
    unread: true,
  },
  {
    id: 'notif-skill-updated',
    title: 'Skill 版本更新完成',
    body: '“知识库检索”已更新至最新版本。',
    time: '2 小时前',
    unread: true,
  },
]
