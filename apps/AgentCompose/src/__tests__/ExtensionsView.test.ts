import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExtensionsView from '../views/ExtensionsView.vue'

/**
 * Pi 扩展页。
 *
 * 重点：市场**不是**进页面就查 —— 切到「市场」页签时才查，
 * 而且只查一次（失败了下次能重试）。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const listed = [
  {
    name: 'orca-prefill',
    path: 'C:/pi/.pi/agent/extensions/orca-prefill.ts',
    source: 'user',
    package: null,
    enabled: true,
    size: 100,
    updatedAtMs: 1,
  },
  {
    name: 'project-ext',
    path: 'C:/proj/.pi/extensions/project-ext.ts',
    source: 'project',
    package: null,
    enabled: true,
    size: 150,
    updatedAtMs: 4,
  },
  {
    name: 'pi-mcp-adapter',
    path: 'C:/lib/extensions/npm/pi-mcp-adapter/index.ts',
    source: 'npm',
    package: null,
    enabled: true,
    size: 200,
    updatedAtMs: 2,
  },
  {
    name: 'my-ext',
    path: 'C:/lib/extensions/custom/my-ext/index.ts',
    source: 'custom',
    package: null,
    enabled: true,
    size: 300,
    updatedAtMs: 3,
  },
]

/** 市场搜索的返回 */
const market = {
  total: 13640,
  offset: 0,
  limit: 40,
  packages: [
    {
      name: 'billion-context',
      description: 'context compression',
      version: '0.1.213',
      author: null,
      repository: null,
      homepage: null,
      weeklyDownloads: 869972,
      publishedAt: null,
      keywords: [],
    },
  ],
}

/** 记下每次 invoke 的命令名 */
const calls = (): string[] => invokeMock.mock.calls.map((call) => String(call[0]))

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, ExtensionsView },
    template: '<NMessageProvider><ExtensionsView /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('Pi 扩展页', () => {
  it('从别的页面切进来才查市场', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })
    // 组件挂在别的路由上（不是 #extensions）
    window.location.hash = '#skills'

    const wrapper = await mountView()
    expect(calls()).toContain('extensions_list')
    expect(calls()).not.toContain('extensions_market_search')

    // 点侧边栏「Pi 扩展」→ hash 变了 → 查市场
    window.location.hash = '#extensions'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()

    expect(calls()).toContain('extensions_market_search')
    wrapper.unmount()
  })

  it('页面内切页签不重复查市场', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })
    window.location.hash = '#extensions'

    const wrapper = await mountView()
    await flushPromises()
    const before = calls().filter((name) => name === 'extensions_market_search').length
    expect(before).toBe(1)

    // 切页签
    const tabs = wrapper.findAll('.n-tabs-tab')
    await tabs[1]!.trigger('click')
    await flushPromises()

    const after = calls().filter((name) => name === 'extensions_market_search').length
    expect(after).toBe(before)
    wrapper.unmount()
  })

  it('已安装的按来源分组：用户级 / 项目级 / 工具箱', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })

    const wrapper = await mountView()
    const groups = wrapper.findAll('.group-name').map((item) => item.text())
    // 三组，顺序固定
    expect(groups).toEqual(['用户级', '项目级', '工具箱'])

    // 工具箱那组里 npm 和自定义分开列
    const subs = wrapper.findAll('.sub-title').map((item) => item.text())
    expect(subs).toEqual(['npm', '自定义'])

    // 扩展名旁边的来源标签
    const tags = wrapper.findAll('.n-tag').map((item) => item.text())
    expect(tags).toContain('用户级')
    expect(tags).toContain('项目级')
  })

  it('pi 自动发现的扩展不能编辑、不能删', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })

    const wrapper = await mountView()
    // 「编辑」只给工具箱里的（npm + 自定义）—— 用户级和项目级那两个没有
    const buttons = wrapper.findAll('button').filter((item) => item.text().includes('编辑'))
    expect(buttons).toHaveLength(2)
  })
})
