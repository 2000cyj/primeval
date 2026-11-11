import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentCreateWizard from '../views/AgentCreateWizard.vue'
import { useCreatedAgents } from '../data/createdAgents'

/**
 * 新建智能体向导：只跑 Pi、skills 用真实数据、MCP 用 MCP 页的数据。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const piAgent = {
  id: 'pi',
  name: 'Pi',
  command: 'pi',
  installed: true,
  version: '0.52.1',
  path: 'D:\\nodejs\\pi.cmd',
  error: null,
  installs: [],
  package: '@earendil-works/pi-coding-agent',
  source: 'npm',
  latestVersion: null,
}

const skills = [
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
]

const mcpServers = [
  {
    id: 'filesystem',
    name: 'File System',
    transport: 'stdio',
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
  },
  {
    id: 'remote',
    name: 'Remote Docs',
    transport: 'http',
    enabled: true,
    url: 'https://mcp.example.com/docs',
  },
]

const stub = (options: { piInstalled?: boolean } = {}): void => {
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    if (command === 'agents_scan') {
      return Promise.resolve(options.piInstalled === false ? [] : [piAgent])
    }
    if (command === 'skills_list') return Promise.resolve(skills)
    if (command === 'mcp_list_servers') return Promise.resolve(mcpServers)
    if (command === 'agents_package_versions') {
      return Promise.resolve(['2.1.320', '2.1.319', '2.1.318'])
    }
    if (command === 'agents_package_plan') {
      return Promise.resolve({
        command: 'pi',
        name: 'Pi',
        package: '@earendil-works/pi-coding-agent',
        manager: 'npm',
        commandLine: 'npm i -g @earendil-works/pi-coding-agent@latest',
        path: '',
        program: 'D:\\nodejs\\npm.cmd',
        args: ['install', '-g', '@earendil-works/pi-coding-agent@latest'],
      })
    }
    if (command === 'agents_install') return Promise.resolve('npm i -g ...')
    if (command === 'created_agents_save') {
      const agent = (payload as { agent: unknown }).agent
      return Promise.resolve(agent)
    }
    if (command === 'created_agents_list') return Promise.resolve([])
    return Promise.resolve(null)
  })
}

/** 弹窗是异步拉方案的，等它一下 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mountWizard = async () => {
  const wrapper = mount({
    components: { NMessageProvider, AgentCreateWizard },
    template: '<NMessageProvider><AgentCreateWizard /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

const clickByText = async (wrapper: Awaited<ReturnType<typeof mountWizard>>, text: string) => {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  expect(button).toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
  await wrapper.vm.$nextTick()
}

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('新建智能体向导', () => {
  it('第一步只给 Pi，并显示它装没装', async () => {
    stub()
    const wrapper = await mountWizard()

    const text = wrapper.text()
    expect(text).toContain('Pi')
    // 探测到的 agent 列表（mock 只返回 pi）
    expect(wrapper.findAll('.harness-item')).toHaveLength(1)
    expect(text).toContain('0.52.1')
    expect(text).not.toContain('Claude Code')
  })

  it('非 Pi 的 agent 禁用选择，右边标灰色的「未适配」', async () => {
    const withOthers = [
      piAgent,
      { ...piAgent, id: 'claude', name: 'Claude Code', command: 'claude' },
    ]
    invokeMock.mockImplementation((command: string, _payload?: unknown) => {
      if (command === 'agents_scan') return Promise.resolve(withOthers)
      return Promise.resolve(null)
    })
    const wrapper = await mountWizard()

    const tags = wrapper.findAll('.harness-tag')
    expect(tags).toHaveLength(1)
    expect(tags[0]!.text()).toBe('未适配')
    // Pi 自己没有这个标
    expect(wrapper.findAll('.harness-item')[0]!.find('.harness-tag').exists()).toBe(false)
  })

  it('探测中显示 loading', async () => {
    // 探测不返回 → 一直 loading
    invokeMock.mockImplementation((command: string, _payload?: unknown) => {
      if (command === 'agents_scan') return new Promise(() => {})
      return Promise.resolve(null)
    })
    const wrapper = mount({
      components: { NMessageProvider, AgentCreateWizard },
      template: '<NMessageProvider><AgentCreateWizard /></NMessageProvider>',
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.harness-loading').exists()).toBe(true)
    expect(wrapper.text()).toContain('正在检测本机 agent')
    wrapper.unmount()
  })

  it('没找到 Pi 时给安装按钮，装完重新探测', async () => {
    stub({ piInstalled: false })
    const wrapper = await mountWizard()

    expect(wrapper.text()).toContain('没检测到 Pi')
    expect(wrapper.text()).toContain('npm i -g @earendil-works/pi-coding-agent@latest')

    // 点安装 → 确认弹窗（弹窗自己拉方案，等它加载完）
    await clickByText(wrapper, '安装 Pi')
    await sleep(50)
    const body = document.body.textContent ?? ''
    expect(body).toContain('确认安装')
    expect(body).toContain('npm i -g @earendil-works/pi-coding-agent@latest')

    // 确认 → 转后台安装
    const confirmButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认安装'),
    ) as HTMLButtonElement
    confirmButton.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'agents_install')
    expect(call?.[1]).toEqual({ command: 'pi', version: null })
  })

  it('Pi 没装时不让进下一步', async () => {
    stub({ piInstalled: false })
    const wrapper = await mountWizard()

    await clickByText(wrapper, '下一步')
    // 还在第一步
    expect(wrapper.text()).toContain('这个智能体在哪里运行？')
  })

  it('第二步点击返回回到第一步，不触发退出', async () => {
    stub()
    const wrapper = await mountWizard()
    await clickByText(wrapper, '下一步')

    await wrapper.find('[aria-label="返回"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('这个智能体在哪里运行？')
    expect(wrapper.findComponent(AgentCreateWizard).emitted('cancel')).toBeUndefined()
  })

  it('skills 用 skills 页的真实数据', async () => {
    stub()
    const wrapper = await mountWizard()
    await clickByText(wrapper, '下一步')

    await clickByText(wrapper, '已选 0 个')
    const body = document.body.textContent ?? ''
    expect(body).toContain('选择 skills')
    expect(body).toContain('知识库检索')
    expect(body).not.toContain('代码解释器')
  })

  it('MCP 用 mcp 页的真实数据', async () => {
    stub()
    const wrapper = await mountWizard()
    await clickByText(wrapper, '下一步')

    // SKILLS 下面就是 MCP
    const labels = wrapper.findAll('.field-label').map((item) => item.text())
    expect(labels).toContain('SKILLS')
    expect(labels).toContain('MCP')

    await wrapper.find('.mcp-toggle').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const body = document.body.textContent ?? ''
    expect(body).toContain('选择 MCP')
    expect(body).toContain('File System')
    expect(body).toContain('Remote Docs')
    expect(body).toContain('stdio')
    expect(body).toContain('https://mcp.example.com/docs')
  })

  it('同名不允许创建', async () => {
    stub()
    // 先建一个同名智能体
    const { add } = useCreatedAgents()
    await add({
      name: '知识助手',
      description: '',
      instruction: '',
      skills: [],
      mcpServers: [],
    })

    const wrapper = await mountWizard()
    await clickByText(wrapper, '下一步')
    await wrapper.find('#agent-name input').setValue('知识助手')
    await clickByText(wrapper, '创建智能体')

    // 创建被拦下：没有 done 事件，也没多出一个智能体
    expect(wrapper.findComponent(AgentCreateWizard).emitted('done')).toBeUndefined()
    const { createdAgents } = useCreatedAgents()
    expect(createdAgents.value.filter((item) => item.name === '知识助手')).toHaveLength(1)
  })

  it('创建时把 skills 与 MCP 一起带出去', async () => {
    stub()
    const wrapper = await mountWizard()
    await clickByText(wrapper, '下一步')

    // 勾一个 skill
    await clickByText(wrapper, '已选 0 个')
    const skillOption = [...document.body.querySelectorAll('.skill-option')][0] as HTMLElement
    skillOption.click()
    await flushPromises()
    await wrapper.vm.$nextTick()

    // 勾一个 MCP
    await wrapper.find('.mcp-toggle').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    const mcpOption = [...document.body.querySelectorAll('.mcp-option')][0] as HTMLElement
    mcpOption.click()
    await flushPromises()
    await wrapper.vm.$nextTick()

    await wrapper.find('#agent-name input').setValue('我的智能体')
    await clickByText(wrapper, '创建智能体')

    const emitted = wrapper.findComponent(AgentCreateWizard).emitted('done')
    expect(emitted).toBeTruthy()
    const payload = emitted?.[0]?.[0] as {
      name: string
      skills: string[]
      mcpServers: string[]
    }
    expect(payload.name).toBe('我的智能体')
    // skill / MCP 都存相对路径引用（不是名字、不是绝对路径）
    expect(payload.skills).toEqual(['skills/知识库检索'])
    expect(payload.mcpServers).toEqual(['mcp/servers.json#filesystem'])
  })
})
