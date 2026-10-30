/**
 * 工作区级汇总指标（mock）
 *
 * 口径说明（对齐实测原型）：
 * - 「Skills 总数」「MCP 服务」取当前工作区 mock 列表的长度；
 * - 「本月调用」是工作区总量口径（24.8k），与单个能力抽屉里的「1,284 次调用」不是同一口径；
 * - 「最近调用」的统计周期是过去 12 天。
 */
export const workspaceStats = {
  /** Skills 总数的辅助说明 */
  skillDelta: '+2 本月',
  /** 工作区本月调用总量 */
  monthlyCalls: '24.8k',
  /** 本月调用环比 */
  monthlyCallsDelta: '↑ 18.6%',
  /** 单能力最近调用的统计周期文案 */
  period: '过去 12 天',
}
