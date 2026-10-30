import { reactive } from 'vue'

// 布局层共享的轻量 UI 状态：顶栏面包屑第二段
const ui = reactive({ crumbTail: '' })

export function useUiState() {
  const setCrumbTail = (value: string) => {
    ui.crumbTail = value
  }
  return { ui, setCrumbTail }
}
