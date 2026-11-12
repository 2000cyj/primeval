import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExtensionPickerModal from '../components/ExtensionPickerModal.vue'

/**
 * 扩展选择弹窗。
 *
 * 工具箱里的扩展用工具箱图标（位图），不再是单色扳手。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const mountPicker = async () => {
  invokeMock.mockResolvedValue([
    {
      name: 'pi-subagents',
      path: 'C:/lib/extensions/npm/pi-subagents/index.ts',
      source: 'npm',
      package: 'pi-subagents',
      enabled: true,
      size: 1024,
      updatedAtMs: 0,
    },
    {
      name: 'my-ext',
      path: 'C:/lib/extensions/custom/my-ext/index.ts',
      source: 'custom',
      package: null,
      enabled: true,
      size: 128,
      updatedAtMs: 0,
    },
  ])
  const wrapper = mount({
    components: { NMessageProvider, ExtensionPickerModal },
    template: `
      <NMessageProvider>
        <ExtensionPickerModal :show="true" :selected="[]" />
      </NMessageProvider>
    `,
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('扩展选择弹窗', () => {
  it('列表里用工具箱图标', async () => {
    await mountPicker()

    // NModal 是 teleport 出去的 —— 得从 document 上找
    const icons = document.querySelectorAll('.toolbox-icon')
    expect(icons.length).toBe(2)
    expect(icons[0].getAttribute('src')).toContain('toolbox-icon')
  })

  it('旧的扳手图标不再出现', async () => {
    await mountPicker()

    expect(document.querySelector('svg.lucide-wrench')).toBeNull()
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  invokeMock.mockReset()
})
