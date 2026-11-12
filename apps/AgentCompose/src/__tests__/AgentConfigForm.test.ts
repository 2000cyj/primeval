import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentConfigForm from '../components/AgentConfigForm.vue'

/**
 * 配置表单：身份 + 行为与能力。
 *
 * 「对话开场建议」已经整个去掉 —— 这里守着它别再回来。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const mountForm = async () => {
  const wrapper = mount({
    components: { NMessageProvider, AgentConfigForm },
    template: `
      <NMessageProvider>
        <AgentConfigForm
          v-model:name="name"
          v-model:description="description"
          v-model:instruction="instruction"
          v-model:skills="skills"
          v-model:mcp-servers="mcpServers"
          v-model:extensions="extensions"
        />
      </NMessageProvider>
    `,
    data: () => ({
      name: '智能体',
      description: '',
      instruction: '',
      skills: [] as string[],
      mcpServers: [] as string[],
      extensions: [] as string[],
    }),
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('配置表单', () => {
  it('渲染身份与行为两个区块', async () => {
    const wrapper = await mountForm()

    const titles = wrapper.findAll('.card-title').map((item) => item.text())
    expect(titles).toEqual(['身份', '行为与能力'])
  })

  it('不再有「对话开场建议」', async () => {
    const wrapper = await mountForm()

    expect(wrapper.text()).not.toContain('对话开场建议')
    expect(wrapper.text()).not.toContain('开场建议')
    expect(wrapper.find('.suggest').exists()).toBe(false)
  })

  it('Skills / MCP 显示已选数量', async () => {
    const wrapper = await mountForm()

    expect(wrapper.text()).toContain('已选 0 个')
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})
