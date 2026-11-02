import { reactive } from 'vue'

export interface ToastItem {
  id: number
  message: string
}

const toasts = reactive<ToastItem[]>([])
let seq = 0

export function useToast() {
  const push = (message: string) => {
    seq += 1
    const id = seq
    toasts.push({ id, message })
    setTimeout(() => {
      const index = toasts.findIndex((item) => item.id === id)
      if (index > -1) toasts.splice(index, 1)
    }, 2600)
  }
  return { toasts, push }
}
