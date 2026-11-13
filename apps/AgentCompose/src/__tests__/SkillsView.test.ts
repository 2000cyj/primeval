import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SkillsView from '../views/SkillsView.vue'

/**
 * 页面数据全部来自 tauri command（Skill 仓库里真实落盘的 skill），不再有 mock 兜底。
 * 因此这里 mock 掉 invoke，模拟读得到 / 读不到两种情况。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const storedSkills = [
  {
    name: '知识库检索',
    description: '从企业知识库中检索并引用信息',
    path: 'C:/Users/test/.agent-compose/skills/知识库检索',
    relativePath: 'skills/知识库检索',
    source: 'manual',
    enabled: true,
    updatedAtMs: 1762300000000,
    fileCount: 1,
  },
  {
    name: '代码解释器',
    description: '运行 Python 代码完成计算任务',
    path: 'C:/Users/test/.agent-compose/skills/代码解释器',
    relativePath: 'skills/代码解释器',
    source: 'url',
    enabled: false,
    updatedAtMs: 1762200000000,
    fileCount: 3,
  },
]

/** 「智能体」页的真实数据：用相对路径引用绑定 skill */
const storedAgents = [
  {
    id: 'agent-1',
    name: '知识助手',
    description: '查文档',
    instruction: '',
    skills: ['skills/知识库检索'],
    mcpServers: [],
    runtime: 'pi',
    version: 1,
    createdAt: 1762300000000,
  },
  {
    id: 'agent-2',
    name: '代码助手',
    description: '写代码',
    instruction: '',
    skills: ['skills/知识库检索', 'skills/代码解释器'],
    mcpServers: [],
    runtime: 'pi',
    version: 1,
    createdAt: 1762300000000,
  },
]

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, SkillsView },
    template: '<NMessageProvider><SkillsView /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

const rows = (wrapper: Awaited<ReturnType<typeof mountView>>) => wrapper.findAll('.skill-row')

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('SkillsView', () => {
  it('渲染 Skill 仓库里真实存在的 skill', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_list' ? Promise.resolve(storedSkills) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    expect(rows(wrapper)).toHaveLength(2)
    expect(wrapper.text()).toContain('知识库检索')
    expect(wrapper.text()).toContain('代码解释器')
  })

  it('Skill 仓库为空时展示空态，不拿假数据充数', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_list' ? Promise.resolve([]) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.get('.empty').text()).toContain('Skill 仓库里还没有 skill')
  })

  it('读取失败时展示真实原因，也不展示假数据', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_list'
        ? Promise.reject(new Error('读取 skill 列表失败：找不到目录'))
        : Promise.resolve(null),
    )
    const wrapper = await mountView()

    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.get('.load-error').text()).toContain('找不到目录')
  })

  it('切换状态开关会更新该行的 aria-checked 并落库', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list') return Promise.resolve(storedSkills)
      if (command === 'skills_set_enabled') return Promise.resolve(null)
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const toggle = rows(wrapper)[0].get('.n-switch')
    expect(toggle.attributes('aria-checked')).toBe('true')

    await toggle.trigger('click')
    await flushPromises()

    expect(rows(wrapper)[0].get('.n-switch').attributes('aria-checked')).toBe('false')
    expect(invokeMock.mock.calls.find((call) => call[0] === 'skills_set_enabled')?.[1]).toEqual({
      name: '知识库检索',
      enabled: false,
    })
  })

  it('列表展示数据来源，标签与新增方式同名', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_list' ? Promise.resolve(storedSkills) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    const sources = wrapper.findAll('.source-tag').map((tag) => tag.text())
    expect(sources).toEqual(['手动创建', '从 URL 导入'])
  })

  it('使用者列展示绑定了该 skill 的智能体名称', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list') return Promise.resolve(storedSkills)
      if (command === 'created_agents_list') return Promise.resolve(storedAgents)
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const users = rows(wrapper).map((row) => row.findAll('.user-tag').map((tag) => tag.text()))
    expect(users[0]).toEqual(['知识助手', '代码助手'])
    expect(users[1]).toEqual(['代码助手'])
  })

  it('没有智能体绑定时显示暂无使用者', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list') return Promise.resolve(storedSkills)
      if (command === 'created_agents_list') return Promise.resolve([])
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    expect(rows(wrapper)[0].get('.cell-users').text()).toContain('暂无使用者')
  })

  it('可以多选 skill，并从来源刷新选中的那些', async () => {
    const refreshable = storedSkills.map((skill) => ({ ...skill, refreshable: true }))
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list') return Promise.resolve(refreshable)
      if (command === 'skills_refresh') {
        return Promise.resolve({ ...refreshable[0], updatedAtMs: 1762400000000 })
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    // 表头一个全选框 + 每行一个
    const checkboxes = wrapper.findAll('.n-checkbox')
    expect(checkboxes).toHaveLength(3)

    await checkboxes[1]!.trigger('click')
    await flushPromises()

    // 更新按钮带上勾选数量
    const refreshButton = wrapper.findAll('button').find((button) => button.text().includes('更新'))
    expect(refreshButton?.text()).toContain('（1）')

    await refreshButton!.trigger('click')
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'skills_refresh')
    expect(call?.[1]).toEqual({ name: '知识库检索' })
  })

  it('没有可更新来源的 skill 会被跳过，不发请求', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list') {
        return Promise.resolve([
          { ...storedSkills[0], refreshable: true },
          { ...storedSkills[1], refreshable: false },
        ])
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const checkboxes = wrapper.findAll('.n-checkbox')
    await checkboxes[1]!.trigger('click')
    await checkboxes[2]!.trigger('click')
    await flushPromises()

    const refreshButton = wrapper.findAll('button').find((button) => button.text().includes('更新'))
    await refreshButton!.trigger('click')
    await flushPromises()

    // 只有可刷新的那个发了请求
    const calls = invokeMock.mock.calls.filter((item) => item[0] === 'skills_refresh')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toEqual({ name: '知识库检索' })
  })

  it('搜索会过滤表格，空结果时展示空状态', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_list' ? Promise.resolve(storedSkills) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    const input = wrapper.get('input')

    await input.setValue('知识库')
    await wrapper.vm.$nextTick()

    expect(rows(wrapper)).toHaveLength(1)
    expect(wrapper.text()).toContain('知识库检索')

    await input.setValue('不存在的技能')
    await wrapper.vm.$nextTick()

    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.get('.empty').text()).toContain('没有匹配的 Skill')
  })
})
