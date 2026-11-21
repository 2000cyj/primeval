import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SkillPickerModal from '../components/SkillPickerModal.vue'

/**
 * 智能体的 skill 选择弹窗。
 *
 * 停用的 skill 要**置灰**：
 * - 未选中的置灰且不让选 —— 用户在 skills 页关了它，就是不想让 agent 用
 * - 已经选中的也置灰，但还能取消 —— 不然就再也解绑不了了
 */
const listSkillsMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/skills', () => ({
  listSkills: listSkillsMock,
}))

const skill = (name: string, enabled: boolean) => ({
  name,
  description: `${name} 的说明`,
  path: `C:/Users/test/.agent-compose/skills/${name}`,
  relativePath: `skills/${name}`,
  source: 'manual' as const,
  enabled,
  refreshable: false,
  updatedAtMs: 0,
  fileCount: 1,
})

/** 已挂载的 wrapper —— 测完要拆掉（NModal 是 teleport 出去的）。 */
const mounted: { unmount: () => void }[] = []

const mountModal = async (selected: string[] = []) => {
  const wrapper = mount({
    components: { NMessageProvider, SkillPickerModal },
    template: `
      <NMessageProvider>
        <SkillPickerModal
          :show="true"
          :selected="selected"
          @update:selected="onSelect"
          @close="onClose"
        />
      </NMessageProvider>
    `,
    data: () => ({ selected, picked: [] as string[] }),
    methods: {
      onSelect(value: string[]) {
        ;(this as unknown as { picked: string[] }).picked = value
      },
      onClose() {},
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  listSkillsMock.mockReset()
})

describe('Skill 选择弹窗', () => {
  // NModal 是 teleport 出去的 —— 得从 document 上找
  const options = (): HTMLElement[] => Array.from(document.querySelectorAll('.skill-option'))

  const optionOf = (name: string): HTMLElement | undefined =>
    options().find((item) => item.querySelector('.skill-name')?.textContent?.trim() === name)

  const picked = (wrapper: { vm: unknown }): string[] => (wrapper.vm as { picked: string[] }).picked

  it('停用的 skill 置灰', async () => {
    listSkillsMock.mockResolvedValue([skill('alpha', true), skill('beta', false)])
    await mountModal()

    expect(optionOf('alpha')?.classList.contains('disabled')).toBe(false)
    expect(optionOf('beta')?.classList.contains('disabled')).toBe(true)
    // 也标了「已停用」，让用户知道为什么灰的
    expect(optionOf('beta')?.querySelector('.skill-off')).toBeTruthy()
  })

  it('停用的 skill 不让新选', async () => {
    listSkillsMock.mockResolvedValue([skill('alpha', true), skill('beta', false)])
    const wrapper = await mountModal()

    optionOf('beta')?.click()
    await flushPromises()

    expect(picked(wrapper)).toEqual([])
  })

  it('已经选中的停用 skill 也置灰，但还能取消', async () => {
    listSkillsMock.mockResolvedValue([skill('alpha', true), skill('beta', false)])
    const wrapper = await mountModal(['skills/beta'])

    // 置灰
    expect(optionOf('beta')?.classList.contains('disabled')).toBe(true)
    // 但勾还在 —— 它确实绑着
    expect(optionOf('beta')?.querySelector('.skill-check.on')).toBeTruthy()

    // 能取消 —— 不然就再也解绑不了了
    optionOf('beta')?.click()
    await flushPromises()
    expect(picked(wrapper)).toEqual([])
  })

  it('全选不带停用的', async () => {
    listSkillsMock.mockResolvedValue([skill('alpha', true), skill('beta', false)])
    const wrapper = await mountModal()

    const selectAll = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === '全选',
    )
    selectAll?.click()
    await flushPromises()

    expect(picked(wrapper)).toEqual(['skills/alpha'])
  })

  it('启用的 skill 照常能选', async () => {
    listSkillsMock.mockResolvedValue([skill('alpha', true), skill('beta', false)])
    const wrapper = await mountModal()

    optionOf('alpha')?.click()
    await flushPromises()

    expect(picked(wrapper)).toEqual(['skills/alpha'])
  })
})
