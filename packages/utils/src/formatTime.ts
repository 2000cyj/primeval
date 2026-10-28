/**
 * 时间格式化工具（yudao 兼容层）
 *
 * 业务文件直接 `import { dateFormatter, formatDate } from '@remote/utils/formatTime'`。
 */
import dayjs from 'dayjs'

/**
 * 表格列 formatter 形式的时间格式化（el-table-column :formatter）。
 *
 *   <el-table-column :formatter="dateFormatter" prop="createTime" />
 */
export const dateFormatter = (
  _row: any,
  _column: any,
  cellValue: any,
  format: string = 'YYYY-MM-DD HH:mm:ss',
): string => {
  if (!cellValue) return ''
  return dayjs(cellValue).format(format)
}

/** 通用日期格式化 */
export const formatDate = (date: any, format: string = 'YYYY-MM-DD HH:mm:ss'): string => {
  if (!date) return ''
  return dayjs(date).format(format)
}

/** 日期范围 formatter（短格式 YYYY-MM-DD） */
export const dateFormatter2 = (_row: any, _column: any, cellValue: any): string => {
  if (!cellValue) return ''
  return dayjs(cellValue).format('YYYY-MM-DD')
}

/** 计算今天起点（00:00:00） */
export const beginOfDay = (date: Date = new Date()): Date => {
  return dayjs(date).startOf('day').toDate()
}

/** 计算今天终点（23:59:59） */
export const endOfDay = (date: Date = new Date()): Date => {
  return dayjs(date).endOf('day').toDate()
}

/** 日期范围预设 —— 用于 el-date-picker shortcuts */
export const defaultShortcuts = [
  {
    text: '最近一周',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 7)
      return [start, end]
    },
  },
  {
    text: '最近一个月',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 30)
      return [start, end]
    },
  },
  {
    text: '最近三个月',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 90)
      return [start, end]
    },
  },
]

/** 相对时间（"几分钟前"），简化版 */
export const formatPast = (date: any): string => {
  if (!date) return ''
  const d = dayjs(date)
  const now = dayjs()
  const diffSec = now.diff(d, 'second')
  if (diffSec < 60) return `${diffSec} 秒前`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
  if (diffSec < 30 * 86400) return `${Math.floor(diffSec / 86400)} 天前`
  return d.format('YYYY-MM-DD')
}
