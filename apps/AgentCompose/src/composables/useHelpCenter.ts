/**
 * 帮助中心的状态。
 *
 * # 为什么放模块作用域
 *
 * 帮助中心有两个入口：
 *
 * - 顶栏的帮助按钮（`AppTopbar`）
 * - 右下角更新提醒弹窗的点击（`useUpdateNotifier`）
 *
 * 后者在别的组件里 —— 状态要是不共享，就得把开关一路往下传。
 * 跟 `useAppUpdate` 一个套路：放模块作用域，谁要用谁取。
 *
 * # 页签为什么也共享
 *
 * 更新提醒点开帮助中心时要**直接停在「版本」页签**。
 *
 * 页签做成可写的计算属性：用户在帮助中心里手动切页签时，
 * 共享状态也跟着变 —— 这样下次打开还在原来那个页签，
 * 而通知弹窗点名要「版本」时也一定切得过去。
 */
import { ref } from 'vue'

/** 帮助中心的页签。 */
export type HelpTab = 'command' | 'page' | 'version'

/** 帮助中心开没开。 */
const helpOpen = ref(false)

/** 当前停在哪个页签。 */
const helpTab = ref<HelpTab>('command')

/**
 * 用帮助中心。
 *
 * - `openHelp()` —— 打开，停在上次的页签；
 * - `openHelp('version')` —— 打开并切到指定页签。
 */
export const useHelpCenter = () => {
  /** 打开帮助中心；给了页签就切过去。 */
  const openHelp = (tab?: HelpTab): void => {
    if (tab) helpTab.value = tab
    helpOpen.value = true
  }

  /** 关掉。 */
  const closeHelp = (): void => {
    helpOpen.value = false
  }

  /** 重置 —— 测试里用（状态是共享的，会串）。 */
  const resetHelpCenter = (): void => {
    helpOpen.value = false
    helpTab.value = 'command'
  }

  return { helpOpen, helpTab, openHelp, closeHelp, resetHelpCenter }
}
