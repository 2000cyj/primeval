/**
 * 窗口外壳状态。
 *
 * Windows 上我们关掉了系统标题栏，改由应用自己画（顶栏 + 窗口按钮）。
 * 这个 composable 只回答一件事：要不要渲染窗口按钮。
 */
import { ref } from 'vue'
import { customTitlebar } from '@/api/window'

/** 全应用共用一份：顶栏和侧边栏都要用 */
const enabled = ref(false)

let initPromise: Promise<void> | null = null

export const useWindowChrome = () => {
  /**
   * 启动时问一次后端。
   *
   * 浏览器里跑（`pnpm dev:web`）没有 Tauri 运行时，调用会失败 —— 那就
   * 退回系统标题栏（浏览器标签页就是系统标题栏），别画窗口按钮。
   */
  const init = async (): Promise<void> => {
    if (!initPromise) {
      initPromise = customTitlebar()
        .then((value) => {
          enabled.value = value === true
        })
        .catch(() => {
          enabled.value = false
        })
    }
    return initPromise
  }

  return { enabled, init }
}
