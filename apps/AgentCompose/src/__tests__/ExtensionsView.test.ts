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
    builtin: false,
    package: null,
    enabled: true,
    size: 100,
    updatedAtMs: 1,
  },
  {
    name: 'project-ext',
    path: 'C:/proj/.pi/extensions/project-ext.ts',
    source: 'project',
    builtin: false,
    package: null,
    enabled: true,
    size: 150,
    updatedAtMs: 4,
  },
  {
    name: 'agentspace',
    path: 'C:/lib/extensions/builtin/agentspace/index.ts',
    source: 'builtin',
    builtin: true,
    package: null,
    enabled: true,
    size: 180,
    updatedAtMs: 5,
  },
  {
    name: 'agentspace-mcp-bridge',
    path: 'C:/lib/extensions/custom/agentspace-mcp-bridge/index.ts',
    source: 'custom',
    builtin: true,
    package: null,
    enabled: true,
    size: 220,
    updatedAtMs: 6,
  },
  {
    name: 'pi-mcp-adapter',
    path: 'C:/lib/extensions/npm/pi-mcp-adapter/index.ts',
    source: 'npm',
    builtin: false,
    package: null,
    enabled: true,
    size: 200,
    updatedAtMs: 2,
  },
  {
    name: 'my-ext',
    path: 'C:/lib/extensions/custom/my-ext/index.ts',
    source: 'custom',
    builtin: false,
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

    // 工具箱那组里 npm / 自定义 / 内置 分开列
    const subs = wrapper.findAll('.sub-title').map((item) => item.text())
    expect(subs).toEqual(['npm', '自定义', '内置'])
  })

  it('内置扩展归到工具箱下的「内置」小标题里', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })

    const wrapper = await mountView()
    const sections = wrapper.findAll('.group')
    const toolbox = sections.find((s) => s.find('.group-name').text() === '工具箱')!

    // 内置那两个在「内置」小标题下
    const builtinSub = toolbox
      .findAll('.sub-group')
      .find((g) => g.find('.sub-title').text() === '内置')!
    const names = builtinSub.findAll('.ext-name').map((item) => item.text())
    expect(names.join(' ')).toContain('agentspace')
    expect(names.join(' ')).toContain('agentspace-mcp-bridge')
    // 用户自己写的在「自定义」小标题下，不在内置里
    expect(names.join(' ')).not.toContain('my-ext')
  })

  it('pi 自动发现的扩展不能编辑、不能删', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })

    const wrapper = await mountView()
    // 「编辑」给工具箱里的（npm + 自定义 + 内置）
    // —— 用户级、项目级那两个（pi 自动发现的）没有
    const buttons = wrapper.findAll('button').filter((item) => item.text().includes('编辑'))
    expect(buttons).toHaveLength(4)
  })

  it('内置扩展没有删除按钮', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })

    const wrapper = await mountView()
    const sections = wrapper.findAll('.group')
    const toolbox = sections.find((s) => s.find('.group-name').text() === '工具箱')!
    const builtinSub = toolbox
      .findAll('.sub-group')
      .find((g) => g.find('.sub-title').text() === '内置')!

    // 内置那一组：每项只留「编辑」，没有删除
    const rows = builtinSub.findAll('.ext')
    expect(rows.length).toBe(2)
    for (const row of rows) {
      // 一项里就一个按钮（编辑），删除那个没渲染
      expect(row.findAll('button').length).toBe(1)
      expect(row.find('button')!.text()).toContain('编辑')
    }
  })

  it('npm 和自定义的扩展还有删除按钮', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      return Promise.resolve(market)
    })

    const wrapper = await mountView()
    const sections = wrapper.findAll('.group')
    const toolbox = sections.find((s) => s.find('.group-name').text() === '工具箱')!

    // npm 1 个 + 自定义 1 个 = 2 项，每项两个按钮（编辑 + 删除）
    const rows = toolbox.findAll('.ext')
    expect(rows.length).toBe(4)
    const withTwo = rows.filter((row) => row.findAll('button').length === 2)
    expect(withTwo).toHaveLength(2)
  })

  it('改内置扩展写回它原来的位置', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'extensions_list') return Promise.resolve(listed)
      if (command === 'extensions_read') return Promise.resolve('// 源码')
      return Promise.resolve({ ok: true, message: '已保存' })
    })

    const wrapper = await mountView()
    const sections = wrapper.findAll('.group')
    const toolbox = sections.find((s) => s.find('.group-name').text() === '工具箱')!
    const builtinSub = toolbox
      .findAll('.sub-group')
      .find((g) => g.find('.sub-title').text() === '内置')!

    // 打开内置那项的编辑器
    const edit = builtinSub.findAll('button').find((item) => item.text().includes('编辑'))!
    await edit.trigger('click')
    await flushPromises()

    // 读的是它自己的路径
    expect(calls()).toContain('extensions_read')

    // 弹窗在 body 上（naive-ui 的 teleport）—— 找「保存」按钮
    const save = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === '保存',
    )
    expect(save).toBeTruthy()
    save!.click()
    await flushPromises()

    // 保存写回同一路径，不是另存一份到 custom/
    const saveCalls = calls().filter((name) => name === 'extensions_save_source')
    expect(saveCalls).toHaveLength(1)
    expect(calls()).not.toContain('extensions_save')
  })
})
