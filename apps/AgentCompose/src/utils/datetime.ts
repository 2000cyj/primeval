/**
 * 时间格式化。
 *
 * Release 的 pub_date 是 ISO8601（如 `2026-11-14T05:50:25Z`）——
 * 直接显示就是一串机器格式。这里转成「2026-11-14 13:50」这种能读的。
 */

/**
 * 把 ISO8601 时间转成「YYYY-MM-DD HH:mm:ss」。
 *
 * 按**本地时区**显示 —— 用户看到的是自己所在时区的发布时刻。
 * 解析不了就原样返回（不显示成空白，也不显示成 Invalid Date）。
 */
export const formatDateTime = (iso: string): string => {
  const trimmed = iso.trim()
  if (!trimmed) return ''

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return trimmed

  const pad = (value: number): string => String(value).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

/**
 * 把 ISO8601 时间转成「多久之前」。
 *
 * 刚发布说「刚刚」，一天内说「3 小时前」，更久就直接给日期。
 */
export const formatRelativeTime = (iso: string): string => {
  const trimmed = iso.trim()
  if (!trimmed) return ''

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`

  return formatDateTime(trimmed)
}
