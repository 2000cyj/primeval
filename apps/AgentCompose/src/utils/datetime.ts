/**
 * 时间格式化 —— 全应用唯一入口。
 *
 * 标准：**绝对时间一律「YYYY-MM-DD HH:mm:ss」（本地时区，带秒）**。
 *
 * 以前每个页面各写各的字符串拼接：有的带秒有的不带，
 * 有的用 `M/D` 有的用 `Y-M-D`，同一条时间在不同页面长得不一样。
 * 现在统一走这里 —— 要改格式只改这一处。
 */

/** 把 Date 拼成「YYYY-MM-DD HH:mm:ss」（本地时区）。 */
const toLocalText = (date: Date): string => {
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
 * 绝对时间：ISO8601 字符串或 epoch 毫秒 → 「YYYY-MM-DD HH:mm:ss」。
 *
 * 按**本地时区**显示 —— 用户看到的是自己所在时区的时刻。
 * 字符串解析不了就原样返回（不显示成空白，也不显示成 Invalid Date）。
 */
export const formatDateTime = (value: string | number): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    return toLocalText(new Date(value))
  }

  const trimmed = value.trim()
  if (!trimmed) return ''

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return trimmed

  return toLocalText(date)
}

/**
 * 相对时间：ISO8601 字符串或 epoch 毫秒 → 「多久之前」。
 *
 * 刚发布说「刚刚」，一天内说「3 小时前」，
 * 超过 30 天回落到绝对格式 —— 「45 天前」不如直接给日期。
 */
export const formatRelativeTime = (value: string | number): string => {
  const date = typeof value === 'number' ? new Date(value) : new Date(value.trim())
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`

  return formatDateTime(value)
}
