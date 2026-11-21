import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import McpView from '../views/McpView.vue'
import { requestMcpReload } from '@/api/mcp'

/**
 * 页面的数据全部来自 tauri command，不再有 mock 兜底。
 * 因此这里 mock 掉 invoke，模拟 sidecar 正常与异常两种情况。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const servers = [
  {
    id: 'filesystem',
    name: 'File System',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    enabled: true,
  },
]

const status = {
  endpoint: 'http://127.0.0.1:7801',
  token: 'test-token',
  port: 7801,
  sessions: 1,
  upstreams: [
    {
      serverId: 'filesystem',
      state: 'ready',
      tools: [{ serverId: 'filesystem', name: 'read_file', inputSchema: { type: 'object' } }],
      reconnectAttempt: 0,
    },
  ],
  exposure: { serverIds: ['filesystem'], toolKeys: ['filesystem::read_file'], maxTools: 150 },
  profiles: [],
}

/** 让 invoke 按 command 名返回对应数据 */
const stubCommands = (): void => {
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case 'mcp_ensure_sidecar':
        return Promise.resolve({ running: true, port: 7801 })
      case 'mcp_list_servers':
        return Promise.resolve(servers)
      case 'mcp_get_status':
        return Promise.resolve(status)
      case 'mcp_get_exposure':
        return Promise.resolve(status.exposure)
      case 'mcp_list_profiles':
        return Promise.resolve([])
      default:
        return Promise.resolve(null)
    }
  })
}

/**
 * 挂着的 wrapper —— 测完要拆掉。
 *
 * 不拆的话，它会一直 watch 那个模块级的刷新信号 ——
 * 下一个用例按刷新时，这个旧实例也跟着重载，计数就乱了。
 */
const mounted: { unmount: () => void }[] = []

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, McpView },
    template: '<NMessageProvider><McpView /></NMessageProvider>',
  })
  mounted.push(wrapper)
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

/**
 * 挂一个 KeepAlive 里的 MCP 页 —— 能真的停用它。
 *
 * KeepAlive 停用时 **watcher 照样会触发**，
 * 而激活时又得补上停用期间欠下的刷新 —— 这两件事都得测到。
 */
const mountCachedView = async () => {
  const show = ref(true)
  const wrapper = mount({
    components: { NMessageProvider, McpView },
    template: `
      <NMessageProvider>
        <KeepAlive>
          <McpView v-if="show" />
        </KeepAlive>
      </NMessageProvider>
    `,
    setup: () => ({ show }),
  })
  mounted.push(wrapper)
  await flushPromises()
  await wrapper.vm.$nextTick()
  return {
    wrapper,
    /** 停用（切走） */
    deactivate: async () => {
      show.value = false
      await flushPromises()
      await wrapper.vm.$nextTick()
    },
    /** 重新激活（切回） */
    activate: async () => {
      show.value = true
      await flushPromises()
      await wrapper.vm.$nextTick()
    },
  }
}

const serverRows = (wrapper: Awaited<ReturnType<typeof mountView>>) => wrapper.findAll('.server')

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('McpView', () => {
  it('点「刷新 token」：调 mcp_refresh_token，接入片段里的 token 跟着更新', async () => {
    stubCommands()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mcp_refresh_token') return Promise.resolve({ token: 'AgentSpace' })
      switch (command) {
        case 'mcp_ensure_sidecar':
          return Promise.resolve({ running: true, port: 7801 })
        case 'mcp_list_servers':
          return Promise.resolve(servers)
        case 'mcp_get_status':
          return Promise.resolve(status)
        case 'mcp_get_exposure':
          return Promise.resolve(status.exposure)
        case 'mcp_list_profiles':
          return Promise.resolve([])
        default:
          return Promise.resolve(null)
      }
    })
    const wrapper = await mountView()

    const refreshButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('刷新 token'))
    expect(refreshButton).toBeTruthy()
    await refreshButton!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'mcp_refresh_token')
    expect(call).toBeTruthy()
    // 片段里的接入地址用的就是新 token
    expect(wrapper.text()).toContain('token=AgentSpace')
  })

  it('渲染上游 MCP server 列表', async () => {
    stubCommands()
    const wrapper = await mountView()

    expect(serverRows(wrapper)).toHaveLength(1)
    expect(wrapper.get('.page-title').text()).toBe('MCP 管理')
  })

  it('展示每个 server 的名称、传输方式与工具数', async () => {
    stubCommands()
    const wrapper = await mountView()

    const first = serverRows(wrapper)[0]!
    expect(first.get('.server-name').text()).toBe('File System')
    expect(first.get('.server-sub').text()).toContain('npx')
    expect(first.get('.server-tools').text()).toMatch(/\d+ 个工具/)
  })

  it('sidecar 不可用时显示失败原因，不展示假数据', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mcp_ensure_sidecar') {
        return Promise.reject(new Error('MCP sidecar 启动超时（15 秒）'))
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    // 真实原因要能看到
    expect(wrapper.get('.load-error-text').text()).toContain('sidecar')
    // 不能拿假数据充数
    expect(serverRows(wrapper)).toHaveLength(0)
  })

  it('「新增 server」能打开编辑弹窗', async () => {
    stubCommands()
    const wrapper = await mountView()

    const addButton = wrapper.findAll('button').find((button) => button.text().includes('新增'))
    expect(addButton).toBeDefined()

    await addButton!.trigger('click')
    await flushPromises()

    // 弹窗被 teleport 到 body
    expect(document.body.textContent).toContain('传输')
  })

  it('顶栏的「刷新工具箱」会刷新 MCP 列表', async () => {
    stubCommands()
    await mountView()

    const before = invokeMock.mock.calls.filter((item) => item[0] === 'mcp_list_servers').length
    expect(before).toBe(1)

    // 顶栏按刷新 —— 发信号
    requestMcpReload()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const after = invokeMock.mock.calls.filter((item) => item[0] === 'mcp_list_servers').length
    expect(after).toBeGreaterThan(before)
  })

  it('页面停用时不重载 —— 用户没看那个页面，别白连一遍上游', async () => {
    stubCommands()
    const view = await mountCachedView()

    const before = invokeMock.mock.calls.filter((item) => item[0] === 'mcp_list_servers').length

    // 切走（KeepAlive 停用时 watcher 照样触发）
    await view.deactivate()
    requestMcpReload()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const after = invokeMock.mock.calls.filter((item) => item[0] === 'mcp_list_servers').length
    expect(after).toBe(before)
  })

  it('停用期间按的刷新，切回来时补上', async () => {
    stubCommands()
    const view = await mountCachedView()

    await view.deactivate()
    requestMcpReload()
    await flushPromises()

    const before = invokeMock.mock.calls.filter((item) => item[0] === 'mcp_list_servers').length

    // 切回来 —— 该补上那次刷新
    await view.activate()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const after = invokeMock.mock.calls.filter((item) => item[0] === 'mcp_list_servers').length
    expect(after).toBeGreaterThan(before)
  })
})
