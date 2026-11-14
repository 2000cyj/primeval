import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BackupExportModal from '../components/BackupExportModal.vue'

/**
 * 导出弹窗的勾选逻辑。
 *
 * 核心是「勾了智能体，它引用的 skill / MCP server / 扩展自动带上」——
 * 智能体只存路径引用，不把被引用的东西带上，导过去就是空壳。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const inventory = {
  agents: [
    {
      id: 'agent-a',
      name: 'agent-a',
      description: '第一个智能体',
      skills: ['skills/vue'],
      // 真实数据里 MCP 的引用是 `mcp/servers.json#<id>` 这种形式
      // （agent.json 存的就是带路径的引用，不是裸 id）
      mcpServers: ['mcp/servers.json#idea'],
      extensions: ['extensions/npm/context-mode'],
    },
    {
      id: 'agent-b',
      name: 'agent-b',
      description: '第二个智能体',
      skills: [],
      mcpServers: [],
      extensions: [],
    },
  ],
  skills: [
    {
      name: 'vue',
      description: 'Vue 技能',
      kind: 'remote',
      sourceLabel: 'github.com/x/vue@1.0',
    },
    { name: 'local-skill', description: '本地技能', kind: 'local', sourceLabel: '' },
  ],
  mcpServers: [
    { id: 'idea', name: 'idea', kind: 'remote', sourceLabel: 'io.github.jetbrains/idea' },
  ],
  extensions: [
    {
      name: 'context-mode',
      source: 'npm',
      kind: 'remote',
      sourceLabel: '@mksglu/context-mode',
    },
  ],
}

const mountModal = async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'backup_inventory') return Promise.resolve(inventory)
    if (command === 'backup_export') {
      return Promise.resolve({
        zipPath: 'C:/tmp/AgentSpace-export.zip',
        fileName: 'AgentSpace-export.zip',
        counts: { agents: 1, skills: 1, mcpServers: 1, extensions: 1 },
      })
    }
    return Promise.resolve(null)
  })

  // 弹窗是「打开时才读库存」的，所以得先把 show 翻成 true
  const show = ref(false)
  const wrapper = mount({
    components: { NMessageProvider, BackupExportModal },
    setup: () => ({ show }),
    template: `
      <NMessageProvider>
        <BackupExportModal :show="show" />
      </NMessageProvider>
    `,
  })
  show.value = true
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

/** 找到那一行的勾选按钮（NModal 是 teleport 出去的，只能在 document 上找）。 */
const rowOf = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('.row')].find((row) => row.textContent?.includes(text))

const buttonOf = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  )

describe('导出弹窗', () => {
  it('勾上智能体后，它引用的 skill / MCP / 扩展自动勾上并标注来源', async () => {
    await mountModal()

    rowOf('agent-a')?.click()
    await flushPromises()

    expect(rowOf('vue')?.className).toContain('checked')
    expect(rowOf('idea')?.className).toContain('checked')
    expect(rowOf('context-mode')?.className).toContain('checked')
    // 自动带出来的要标出来，用户才知道它为什么被勾上
    expect(rowOf('vue')?.textContent).toContain('随智能体带出')
  })

  it('手动取消自动带出来的条目，导出时就不带它', async () => {
    await mountModal()

    rowOf('agent-a')?.click()
    await flushPromises()
    rowOf('vue')?.click()
    await flushPromises()

    expect(rowOf('vue')?.className).not.toContain('checked')

    buttonOf('导出')?.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'backup_export')
    expect(call).toBeTruthy()
    expect(call?.[1]).toEqual({
      request: {
        agentIds: ['agent-a'],
        skillNames: [],
        mcpServerIds: ['idea'],
        extensionNames: ['context-mode'],
      },
    })
  })

  it('什么都没勾时导出按钮是禁用的', async () => {
    await mountModal()

    expect(buttonOf('导出')?.className).toContain('n-button--disabled')

    rowOf('local-skill')?.click()
    await flushPromises()

    expect(buttonOf('导出')?.className).not.toContain('n-button--disabled')
  })

  it('智能体引用的是 `mcp/servers.json#<id>` 时也能对上库存里的 id', async () => {
    await mountModal()

    // 引用格式对不上就带不出来 —— 之前踩过这个坑：
    // 引用是 `mcp/servers.json#idea`，库存里是 `idea`
    rowOf('agent-a')?.click()
    await flushPromises()

    expect(rowOf('idea')?.className).toContain('checked')

    buttonOf('导出')?.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'backup_export')
    expect(call?.[1]).toEqual({
      request: {
        agentIds: ['agent-a'],
        skillNames: ['vue'],
        mcpServerIds: ['idea'],
        extensionNames: ['context-mode'],
      },
    })
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  invokeMock.mockReset()
})
