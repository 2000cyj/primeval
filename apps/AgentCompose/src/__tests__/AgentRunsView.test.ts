import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentRunsView from '../views/AgentRunsView.vue'
import { useCreatedAgents } from '../data/createdAgents'

/**
 * 智能体页：名称列上下排名称/描述，MCP 列显示个数。
 *
 * 智能体是落盘的（Rust 侧 `created_agents_*`），这里把 invoke 打桩成内存实现。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

/** 落盘模拟：一个数组当磁盘 */
const disk: CreatedAgentRecord[] = []

type CreatedAgentRecord = {
  id: string
  name: string
  description: string
  instruction: string
  skills: string[]
  mcpServers: string[]
  version: number
  createdAt: number
}

const stub = (): void => {
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    if (command === 'mcp_list_servers') return Promise.resolve([])
    if (command === 'created_agents_list') return Promise.resolve([...disk])
    if (command === 'created_agents_save') {
      const agent = (payload as { agent: CreatedAgentRecord }).agent
      const index = disk.findIndex((item) => item.id === agent.id)
      // 后端统一管版本号：新建从 1 开始，更新 = 旧的 +1
      agent.version = index >= 0 ? disk[index]!.version + 1 : 1
      if (index >= 0) disk[index] = agent
      else disk.unshift(agent)
      return Promise.resolve(agent)
    }
    if (command === 'created_agents_delete') {
      const { id } = payload as { id: string }
      const index = disk.findIndex((item) => item.id === id)
      if (index >= 0) disk.splice(index, 1)
      return Promise.resolve(null)
    }
    return Promise.resolve(null)
  })
}

/** 建一个智能体（走真实的 store，落进 mock 的磁盘） */
const createAgent = async (
  agent: Partial<Omit<CreatedAgentRecord, 'id' | 'createdAt'>> = {},
): Promise<CreatedAgentRecord> => {
  const { add } = useCreatedAgents()
  const created = await add({
    name: '智能体',
    description: '',
    instruction: '',
    skills: [],
    mcpServers: [],
    extensions: [],
    ...agent,
  })
  return created
}

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, AgentRunsView },
    template: '<NMessageProvider><AgentRunsView /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
  disk.length = 0
})

describe('智能体页', () => {
  it('名称列把名称与描述上下排列', async () => {
    stub()
    await createAgent({ name: '知识助手', description: '回答知识库里的问题' })

    const wrapper = await mountView()

    const nameCell = wrapper.find('.cell-name')
    expect(nameCell.find('.cell-title').text()).toBe('知识助手')
    expect(nameCell.find('.cell-sub').text()).toBe('回答知识库里的问题')
    // 上下排列：文本块是竖排的
    expect(nameCell.find('.cell-text').exists()).toBe(true)
  })

  it('MCP 列显示绑定的 server 个数', async () => {
    stub()
    await createAgent({ name: '带 MCP 的智能体', mcpServers: ['filesystem', 'docs'] })

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('MCP')
    expect(wrapper.text()).toContain('2 个 MCP')
  })

  it('没绑 MCP 时显示 0 个', async () => {
    stub()
    await createAgent({ name: '没 MCP 的智能体' })

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('0 个 MCP')
  })

  it('点数据行进入编辑页', async () => {
    stub()
    const created = await createAgent({ name: '可编辑的智能体' })

    const wrapper = await mountView()

    await wrapper.find('.run-row').trigger('click')

    const emitted = wrapper.findComponent(AgentRunsView).emitted('edit')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe(created.id)
  })
})
