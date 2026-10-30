import { computed, ref } from 'vue'
import type { Capability } from '../mocks/types'
import { initialMcps } from '../mocks/mcps'
import { initialSkills } from '../mocks/skills'

// 模块级单例：能力中心、能力详情抽屉、对话框共享同一份 mock 能力数据
const skills = ref<Capability[]>(initialSkills.map((item) => ({ ...item })))
const mcps = ref<Capability[]>(initialMcps.map((item) => ({ ...item })))

export function useCapabilities() {
  const all = computed<Capability[]>(() => [...skills.value, ...mcps.value])

  const findById = (id: string) => all.value.find((item) => item.id === id)

  /** 删除能力（能力中心与详情抽屉共用，避免两处口径不一致） */
  const remove = (id: string) => {
    skills.value = skills.value.filter((item) => item.id !== id)
    mcps.value = mcps.value.filter((item) => item.id !== id)
  }

  /** 设置启用状态，并同步「当前状态」文案（实测原型口径：启用 = 运行中，停用 = 已停用） */
  const setEnabled = (cap: Capability, enabled: boolean) => {
    cap.enabled = enabled
    cap.statusLabel = enabled ? '运行中' : '已停用'
  }

  /** 切换启用状态 */
  const toggle = (cap: Capability) => {
    setEnabled(cap, !cap.enabled)
  }

  return { skills, mcps, all, findById, remove, setEnabled, toggle }
}
