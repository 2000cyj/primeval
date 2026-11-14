import { mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { describe, expect, it, vi } from 'vitest'
import AppTopbar from '../components/AppTopbar.vue'

/**
 * 顶栏的帮助按钮。
 *
 * 帮助中心不是弹个 toast 就完事 —— 要打开一个能搜的弹窗。
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}))

describe('顶栏帮助', () => {
  it('点帮助按钮打开帮助弹窗', async () => {
    const wrapper = mount({
      components: { NMessageProvider, AppTopbar },
      template: '<NMessageProvider><AppTopbar /></NMessageProvider>',
    })

    const button = wrapper.find('button[aria-label="帮助"]')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    await wrapper.vm.$nextTick()

    // 弹窗内容在 body 里（teleport）
    const body = document.body.innerHTML
    expect(body).toContain('命令行')
    expect(body).toContain('界面')
    expect(body).toContain('agentspace run')
  })
})
