import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsView from '../views/SettingsView.vue'

/**
 * 设置页的版本检测。
 *
 * 三态：未检查 / 有新版本 / 已是最新。
 */

/** 后端命令的返回值，按用例改。 */
const updateResult = vi.hoisted(() => ({
  current: {
    currentVersion: '1.0.0',
    latestVersion: '1.2.0',
    hasUpdate: true,
    notes: '修了一些问题',
    publishedAt: '2026-11-13T10:00:00Z',
    releaseUrl: 'https://github.com/2000cyj/primeval/releases/tag/v1.2.0',
    downloadUrl: 'https://github.com/2000cyj/primeval/releases/download/v1.2.0/setup.exe',
    portableUrl: '',
  } as Record<string, unknown> | null,
  fail: false,
}))

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
}))

const openUrlMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/extensions', () => ({
  openExternal: openUrlMock,
}))

/**
 * 进度事件的 listen —— 真实环境由 Tauri 提供，测试里返回个取消函数就行。
 */
const listenMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

/** 挂设置页 */
const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, SettingsView },
    template: '<NMessageProvider><SettingsView /></NMessageProvider>',
    attachTo: document.body,
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

/** 找按钮（按文字）。SettingsView 不 teleport，内容在 wrapper 里。 */
const buttonByText = (wrapper: VueWrapper, text: string): DOMWrapper<Element> | undefined =>
  wrapper.findAll('button').find((el) => el.text().includes(text))

afterEach(() => {
  invokeMock.mockReset()
  openUrlMock.mockReset()
  listenMock.mockClear()
  document.body.innerHTML = ''
})

describe('设置页版本检测', () => {
  it('初始是「检查最新版本」', async () => {
    updateResult.current = null
    updateResult.fail = false
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') {
        return Promise.reject(new Error('不该被调用'))
      }
      return Promise.resolve([])
    })

    const wrapper = await mountView()
    expect(buttonByText(wrapper, '检查最新版本')).toBeTruthy()
  })

  it('检测到新版本时按钮变成「更新到 X.Y.Z」，并显示发布说明', async () => {
    updateResult.current = {
      currentVersion: '1.0.0',
      latestVersion: '1.2.0',
      hasUpdate: true,
      notes: '修了一些问题',
      publishedAt: '2026-11-13T10:00:00Z',
      releaseUrl: 'https://github.com/2000cyj/primeval/releases/tag/v1.2.0',
      downloadUrl: 'https://github.com/2000cyj/primeval/releases/download/v1.2.0/setup.exe',
      portableUrl: '',
    }
    updateResult.fail = false
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') return Promise.resolve(updateResult.current)
      return Promise.resolve([])
    })

    const wrapper = await mountView()
    const button = buttonByText(wrapper, '检查最新版本')
    await button?.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const text = wrapper.text()
    expect(text).toContain('更新到 1.2.0')
    expect(text).toContain('修了一些问题')
    expect(text).toContain('检测到新版本')
  })

  it('已是最新时按钮禁用并显示「已是最新版本」', async () => {
    updateResult.current = {
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      hasUpdate: false,
      notes: '',
      publishedAt: '',
      releaseUrl: '',
      downloadUrl: '',
      portableUrl: '',
    }
    updateResult.fail = false
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') return Promise.resolve(updateResult.current)
      return Promise.resolve([])
    })

    const wrapper = await mountView()
    const button = buttonByText(wrapper, '检查最新版本')
    await button?.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const latest = buttonByText(wrapper, '已是最新版本')
    expect(latest).toBeTruthy()
    expect(latest?.attributes('disabled')).toBeDefined()
  })

  it('检测失败时回到未检查状态并报错', async () => {
    updateResult.fail = true
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') return Promise.reject(new Error('连不上 GitHub'))
      return Promise.resolve([])
    })

    const wrapper = await mountView()
    const button = buttonByText(wrapper, '检查最新版本')
    await button?.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(buttonByText(wrapper, '检查最新版本')).toBeTruthy()
    expect(document.body.textContent ?? '').toContain('连不上 GitHub')
  })

  it('点「更新到」在应用内下载并安装，不打开浏览器', async () => {
    updateResult.current = {
      currentVersion: '1.0.0',
      latestVersion: '1.2.0',
      hasUpdate: true,
      notes: '',
      publishedAt: '',
      releaseUrl: 'https://github.com/2000cyj/primeval/releases/tag/v1.2.0',
      downloadUrl: 'https://github.com/2000cyj/primeval/releases/download/v1.2.0/setup.exe',
      portableUrl: '',
    }
    updateResult.fail = false
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') return Promise.resolve(updateResult.current)
      // 应用内更新：后端下载 + 验签 + 安装
      if (cmd === 'install_update_and_restart') return Promise.resolve(true)
      return Promise.resolve([])
    })

    const wrapper = await mountView()
    await buttonByText(wrapper, '检查最新版本')?.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    await buttonByText(wrapper, '更新到 1.2.0')?.trigger('click')
    await flushPromises()

    // 走的是后端的应用内更新命令
    expect(invokeMock).toHaveBeenCalledWith('install_update_and_restart')
    // 不是把用户丢到浏览器
    expect(openUrlMock).not.toHaveBeenCalled()
  })
})
