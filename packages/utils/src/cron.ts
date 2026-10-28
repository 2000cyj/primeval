/**
 * Cron 工具占位（用于 IoT 规则引擎场景）
 *
 * 完整实现见 yudao 源码 src/utils/cron.ts；此处先提供必需的最小 API。
 */

export const CronUtils = {
  /** 校验 cron 表达式（占位：仅检查 6/7 段格式） */
  validate(expression: string): boolean {
    if (!expression) return false
    const segments = expression.trim().split(/\s+/)
    return segments.length === 6 || segments.length === 7
  },

  /** 把 cron 表达式转成可读的中文描述（占位：原样返回） */
  toHumanReadable(expression: string): string {
    return expression || ''
  },

  /** 计算指定 cron 接下来 N 次的执行时间（占位：返回空数组） */
  nextRunTimes(_expression: string, _count: number = 5): Date[] {
    return []
  },

  /** 格式化 cron 表达式（占位：trim 后原样返回） */
  format(expression: string): string {
    return (expression || '').trim()
  },

  /** 获取触发频率中文描述（占位：返回原表达式） */
  getFrequencyDescription(expression: string): string {
    return CronUtils.toHumanReadable(expression)
  },

  /** 获取下次执行时间（占位：永远返回 '-'） */
  getNextExecutionTime(_expression: string): string {
    return '-'
  },
}
