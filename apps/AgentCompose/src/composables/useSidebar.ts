/**
 * 侧边栏收起状态。
 *
 * 收起后只剩图标列（52px），标签靠 Tooltip 提示。
 * 状态存 localStorage —— 下次打开还保持用户上次的选择。
 */
import { ref, watch } from 'vue'

/** localStorage 键 */
const STORAGE_KEY = 'agentspace.sidebar.collapsed'

/** 全应用共用一份 */
const collapsed = ref(false)

let ready = false

export const useSidebar = () => {
  /**
   * 读一次存档并开始监听变化。
   *
   * 只做一次：多个组件都调 initSidebar 也只初始化一遍。
   */
  const init = (): void => {
    if (ready) return
    ready = true

    try {
      collapsed.value = window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // 存不了就算了，用展开状态
    }

    watch(collapsed, (value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
      } catch {
        // 忽略：存不了不影响使用
      }
    })
  }

  /** 收起 / 展开 */
  const toggle = (): void => {
    collapsed.value = !collapsed.value
  }

  return { collapsed, init, toggle }
}
