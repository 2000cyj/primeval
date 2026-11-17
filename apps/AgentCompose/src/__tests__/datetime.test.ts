import { describe, expect, it } from 'vitest'
import { formatDateTime, formatRelativeTime } from '@/utils/datetime'

/** 拼出「YYYY-MM-DD HH:mm:ss」——本地时区。 */
const local = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

describe('formatDateTime', () => {
  it('ISO 字符串转成本地时间，带秒', () => {
    const date = new Date(2026, 10, 17, 9, 5, 3)
    expect(formatDateTime(date.toISOString())).toBe(local(date))
  })

  it('epoch 毫秒转成本地时间，带秒', () => {
    const date = new Date(2026, 10, 17, 9, 5, 3)
    expect(formatDateTime(date.getTime())).toBe('2026-11-17 09:05:03')
  })

  it('秒位补零，不会漏掉', () => {
    // 秒是 0 时也要显示成 00，不能被截掉
    const date = new Date(2026, 0, 2, 3, 4, 0)
    expect(formatDateTime(date.getTime())).toBe('2026-01-02 03:04:00')
  })

  it('空字符串返回空', () => {
    expect(formatDateTime('')).toBe('')
    expect(formatDateTime('   ')).toBe('')
  })

  it('解析不了就原样返回，不显示 Invalid Date', () => {
    expect(formatDateTime('不是时间')).toBe('不是时间')
  })

  it('非法数字返回空', () => {
    expect(formatDateTime(Number.NaN)).toBe('')
  })
})

describe('formatRelativeTime', () => {
  it('一分钟内说「刚刚」', () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe('刚刚')
  })

  it('一小时内说「N 分钟前」', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5 分钟前')
  })

  it('一天内说「N 小时前」', () => {
    expect(formatRelativeTime(Date.now() - 3 * 3_600_000)).toBe('3 小时前')
  })

  it('30 天内说「N 天前」', () => {
    expect(formatRelativeTime(Date.now() - 10 * 86_400_000)).toBe('10 天前')
  })

  it('超过 30 天回落到完整时间戳（带秒）', () => {
    const date = new Date(2026, 10, 17, 9, 5, 3)
    const old = date.getTime() - 60 * 86_400_000
    // 回落到的是**那个旧时间点**本身，不是当前时间
    expect(formatRelativeTime(old)).toBe(local(new Date(old)))
    expect(formatRelativeTime(old)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('解析不了返回空', () => {
    expect(formatRelativeTime('不是时间')).toBe('')
  })
})
