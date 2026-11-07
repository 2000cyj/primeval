import { ref } from 'vue'

const toast = ref('')
let timer = 0

/** 全局轻提示：任意组件调用 notify 即可 */
export const useToast = () => {
  const notify = (message: string) => {
    toast.value = message
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      toast.value = ''
    }, 2000)
  }
  return { toast, notify }
}
