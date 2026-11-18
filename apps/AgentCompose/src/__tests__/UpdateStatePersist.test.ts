import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { NMessageProvider } from 'naive-ui'
import SettingsView from '../views/SettingsView.vue'
import { resetUpdateState } from '@/composables/useAppUpdate'

/**
 * 更新状态在视图切换后的表现。
 *
 * 现象：系统设置里检查到新版本，切到别的页面再切回来，
 * 「检测到新版本」那块没了，又变回「检查最新版本」。
 *
 * 根因：更新状态原来是组件内的局部 state，而这个页面是视图 ——
 * 切走时组件被 `v-else` 卸载，状态跟着没了。
 *
 * 现在状态在模块作用域（`@/composables/useAppUpdate`），全应用共享一份，
 * 组件卸载重建都不影响。
 */

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const listenMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

const openUrlMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/extensions', () => ({ openExternal: openUrlMock }))

const updateInfo = {
  currentVersion: '1.0.0',
  latestVersion: '1.2.0',
  hasUpdate: true,
  notes: '修了一些问题',
  publishedAt: '2026-11-13T10:00:00Z',
  releaseUrl: 'https://github.com/2000cyj/primeval/releases/tag/v1.2.0',
  downloadUrl: '',
  portableUrl: '',
}

/** 找按钮（按文字）。 */
const buttonByText = (wrapper: VueWrapper, text: string): DOMWrapper<Element> | undefined =>
  wrapper.findAll('button').find((el) => el.text().includes(text))

beforeEach(() => {
  resetUpdateState()
  invokeMock.mockReset()
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'check_app_update') return Promise.resolve(updateInfo)
    return Promise.resolve([])
  })
})

afterEach(() => {
  resetUpdateState()
  document.body.innerHTML = ''
})

describe('视图切换后的更新状态', () => {
  it('切到别的页面再切回来，「检测到新版本」还在', async () => {
    // 一个能切换视图的壳 —— 模拟侧边栏切页
    const which = { value: 'settings' }
    const Shell = defineComponent({
      components: { NMessageProvider, SettingsView },
      setup() {
        return () =>
          h(NMessageProvider, null, {
            default: () => (which.value === 'settings' ? h(SettingsView) : h('div', '别的页面')),
          })
      },
    })
    const wrapper = mount(Shell, { attachTo: document.body })
    await nextTick()

    // 检查更新 → 出现「更新到 X.Y.Z」
    const check = buttonByText(wrapper as VueWrapper, '检查最新版本')
    await check?.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(buttonByText(wrapper as VueWrapper, '更新到 1.2.0')).toBeTruthy()

    // 切走 —— SettingsView 被卸载
    which.value = 'other'
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    // 切回来 —— 组件重新创建
    which.value = 'settings'
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    // 更新状态还在（不用重新检查）
    expect(buttonByText(wrapper as VueWrapper, '更新到 1.2.0')).toBeTruthy()
    expect(buttonByText(wrapper as VueWrapper, '检查最新版本')).toBeFalsy()
  })
})
