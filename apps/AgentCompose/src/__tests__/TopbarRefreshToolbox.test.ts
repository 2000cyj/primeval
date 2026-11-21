import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import AppTopbar from '../components/AppTopbar.vue'
import AgentsView from '../views/AgentsView.vue'
import { agentScan, agentScanError } from '@/api/agents'
import { mcpReloadTick } from '@/api/mcp'
import { skillReloadTick } from '@/api/skills'

/**
 * 顶栏的「刷新工具箱」按钮。
 *
 * 工具箱的数据是**模块级共享**的 —— 侧边栏计数、工具箱页面、
 * 顶栏的刷新按钮看的都是同一份。所以顶栏刷完，页面不用重新加载
 * 就该是新的。
 */

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const listenMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

/** 一条探测结果。 */
const detected = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    installed: true,
    version: '2.1.311',
    path: 'D:\\nodejs\\claude.cmd',
    error: null,
    installs: [],
  },
]

/** 挂一个带顶栏的壳。 */
const mountTopbar = () =>
  mount(NMessageProvider, {
    attachTo: document.body,
    slots: { default: () => h(AppTopbar) },
  })

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation((command: string) => {
    if (command === 'agents_scan') return Promise.resolve(detected)
    return Promise.resolve([])
  })
  agentScan.value = []
  agentScanError.value = ''
})

afterEach(() => {
  agentScan.value = []
  agentScanError.value = ''
  document.body.innerHTML = ''
})

describe('顶栏的刷新工具箱按钮', () => {
  it('点一下就重新探测，刷新全局结果', async () => {
    const wrapper = mountTopbar()
    await flushPromises()

    // 探测前还没数据
    expect(agentScan.value).toEqual([])

    const button = document.querySelector<HTMLButtonElement>('[aria-label="刷新工具箱"]')
    expect(button).toBeTruthy()

    button?.click()
    await flushPromises()

    // 全局结果更新了 —— 侧边栏计数和工具箱页面看的都是这份
    expect(agentScan.value).toHaveLength(1)
    expect(agentScan.value[0]?.name).toBe('Claude Code')

    wrapper.unmount()
  })

  it('工具箱页面看到的是同一份结果', async () => {
    // 页面自己挂上（也会触发一次扫描）
    const page = mount(NMessageProvider, {
      attachTo: document.body,
      slots: { default: () => h(AgentsView) },
    })
    await flushPromises()

    expect(agentScan.value).toHaveLength(1)
    expect(document.body.textContent ?? '').toContain('Claude Code')

    page.unmount()
  })

  it('探测失败时说清楚原因', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.reject(new Error('sidecar 未运行'))
      return Promise.resolve([])
    })

    const wrapper = mountTopbar()
    await flushPromises()

    const button = document.querySelector<HTMLButtonElement>('[aria-label="刷新工具箱"]')
    button?.click()
    await flushPromises()

    expect(agentScanError.value).toContain('sidecar 未运行')
    // 失败不留旧数据 —— 留着会让人以为「现在还是这样」
    expect(agentScan.value).toEqual([])

    wrapper.unmount()
  })

  it('也会让 MCP 页重新拉数据', async () => {
    const wrapper = mountTopbar()
    await flushPromises()

    const before = mcpReloadTick.value

    const button = document.querySelector<HTMLButtonElement>('[aria-label="刷新工具箱"]')
    button?.click()
    await flushPromises()

    // 顶栏的刷新是全局动作 —— MCP 列表也得跟着刷
    expect(mcpReloadTick.value).toBeGreaterThan(before)

    wrapper.unmount()
  })

  it('也会让 Skills 页重新拉数据', async () => {
    const wrapper = mountTopbar()
    await flushPromises()

    const before = skillReloadTick.value

    const button = document.querySelector<HTMLButtonElement>('[aria-label="刷新工具箱"]')
    button?.click()
    await flushPromises()

    expect(skillReloadTick.value).toBeGreaterThan(before)

    wrapper.unmount()
  })
})
