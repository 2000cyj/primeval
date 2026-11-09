import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it } from 'vitest'
import McpView from '../views/McpView.vue'

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, McpView },
    template: '<NMessageProvider><McpView /></NMessageProvider>',
  })
  // 列表是异步拉取的（无 sidecar 时降级到 mock）
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

const servers = (wrapper: Awaited<ReturnType<typeof mountView>>) => wrapper.findAll('.server')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('McpView', () => {
  it('渲染上游 MCP server 列表', async () => {
    const wrapper = await mountView()

    expect(servers(wrapper).length).toBeGreaterThan(0)
    expect(wrapper.get('.page-title').text()).toBe('MCP 管理')
  })

  it('降级模式下页面不白屏，仍能列出 server', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('.page').exists()).toBe(true)
    expect(servers(wrapper).length).toBeGreaterThan(0)
  })

  it('展示每个 server 的名称、传输方式与工具数量', async () => {
    const wrapper = await mountView()

    const first = servers(wrapper)[0]!
    expect(first.get('.server-name').text().length).toBeGreaterThan(0)
    expect(first.get('.server-sub').text().length).toBeGreaterThan(0)
    expect(first.get('.server-tools').text()).toMatch(/\d+ 个工具/)
  })

  it('「新增 server」能打开编辑弹窗', async () => {
    const wrapper = await mountView()

    const addButton = wrapper.findAll('button').find((button) => button.text().includes('新增'))
    expect(addButton).toBeDefined()

    await addButton!.trigger('click')
    await flushPromises()

    // 弹窗被 teleport 到 body
    expect(document.body.textContent).toContain('传输')
  })
})
