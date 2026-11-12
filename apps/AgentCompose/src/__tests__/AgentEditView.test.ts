import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentEditView from '../views/AgentEditView.vue'
import { useCreatedAgents } from '../data/createdAgents'

/**
 * 编辑智能体页：读出智能体当前值，改完保存回磁盘。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

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

/** 落盘模拟 */
const disk: CreatedAgentRecord[] = []

const stub = (): void => {
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    if (command === 'skills_list') return Promise.resolve([])
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

const createAgent = async (
  agent: Partial<Omit<CreatedAgentRecord, 'id' | 'createdAt'>> = {},
): Promise<CreatedAgentRecord> => {
  const { add } = useCreatedAgents()
  return add({
    name: '智能体',
    description: '',
    instruction: '',
    skills: [],
    mcpServers: [],
    extensions: [],
    ...agent,
  })
}

const mountView = async (agentId: string) => {
  const wrapper = mount({
    components: { NMessageProvider, AgentEditView },
    template: '<NMessageProvider><AgentEditView :agent-id="id" /></NMessageProvider>',
    data: () => ({ id: agentId }),
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
  disk.length = 0
  // store 是模块级单例：清掉，免得下一条测到上一条留下的智能体
  const { createdAgents, remove } = useCreatedAgents()
  for (const agent of [...createdAgents.value]) remove(agent.id)
})

describe('编辑智能体页', () => {
  it('把智能体当前的值填进表单', async () => {
    stub()
    const created = await createAgent({
      name: '知识助手',
      description: '回答知识库里的问题',
      instruction: '只根据知识库回答',
      skills: ['skills/kb'],
      mcpServers: ['mcp/servers.json#filesystem'],
    })

    const wrapper = await mountView(created.id)

    expect((wrapper.find('#agent-name input').element as HTMLInputElement).value).toBe('知识助手')
    expect((wrapper.find('#agent-desc textarea').element as HTMLTextAreaElement).value).toBe(
      '回答知识库里的问题',
    )
    expect((wrapper.find('#agent-instruction textarea').element as HTMLTextAreaElement).value).toBe(
      '只根据知识库回答',
    )
    expect(wrapper.text()).toContain('已选 1 个')
  })

  it('保存后写回磁盘', async () => {
    stub()
    const created = await createAgent({ name: '老名字' })

    const wrapper = await mountView(created.id)

    await wrapper.find('#agent-name input').setValue('新名字')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(disk[0]!.name).toBe('新名字')
    // 保存后通知父组件，父组件负责跳回列表
    expect(wrapper.findComponent(AgentEditView).emitted('saved')).toBeTruthy()
  })

  it('指令单独落在 AGENTS.md 那份数据里（这里只管读写接口）', async () => {
    stub()
    const created = await createAgent({ name: '带指令的', instruction: '只按这个来' })

    const wrapper = await mountView(created.id)

    await wrapper.find('#agent-instruction textarea').setValue('改成这个')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(disk[0]!.instruction).toBe('改成这个')
    expect(created.id).toBeTruthy()
  })

  it('每次保存版本号 +1', async () => {
    stub()
    const created = await createAgent({ name: '会变版本的智能体' })
    expect(created.version).toBe(1)

    const wrapper = await mountView(created.id)
    await wrapper.find('#agent-desc textarea').setValue('改了描述')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(disk[0]!.version).toBe(2)
  })

  it('改成别的智能体已有的名字时不保存', async () => {
    stub()
    await createAgent({ name: '另一个智能体' })
    const created = await createAgent({ name: '老名字' })

    const wrapper = await mountView(created.id)

    await wrapper.find('#agent-name input').setValue('另一个智能体')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(disk.find((item) => item.id === created.id)!.name).toBe('老名字')
    expect(wrapper.findComponent(AgentEditView).emitted('saved')).toBeUndefined()
  })

  it('名称为空时不保存', async () => {
    stub()
    const created = await createAgent({ name: '老名字' })

    const wrapper = await mountView(created.id)

    await wrapper.find('#agent-name input').setValue('  ')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(disk[0]!.name).toBe('老名字')
    expect(wrapper.findComponent(AgentEditView).emitted('saved')).toBeUndefined()
  })
})
