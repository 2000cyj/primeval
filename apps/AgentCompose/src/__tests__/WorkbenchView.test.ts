import { mount } from '@vue/test-utils'
import { NMessageProvider, NRadioGroup } from 'naive-ui'
import { describe, expect, it } from 'vitest'
import WorkbenchView from '../views/WorkbenchView.vue'

const mountView = () =>
  mount({
    components: { NMessageProvider, WorkbenchView },
    template: '<NMessageProvider><WorkbenchView /></NMessageProvider>',
  })

const switchTab = async (wrapper: ReturnType<typeof mountView>, value: string) => {
  wrapper.findComponent(NRadioGroup).vm.$emit('update:value', value)
  await wrapper.vm.$nextTick()
}

describe('WorkbenchView', () => {
  it('默认展示 Claude Code 及其已绑定能力', () => {
    const wrapper = mountView()

    expect(wrapper.get('.detail-name').text()).toBe('Claude Code')
    expect(wrapper.findAll('.capability')).toHaveLength(6)
  })

  it('切换智能体后，已绑定能力列表随之变化', async () => {
    const wrapper = mountView()
    const geminiItem = wrapper
      .findAll('.list-item')
      .find((item) => item.text().includes('Gemini CLI'))

    await geminiItem?.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.detail-name').text()).toBe('Gemini CLI')
    expect(wrapper.findAll('.capability')).toHaveLength(5)
  })

  it('切到 MCP 标签展示空态，切回 Skills 恢复能力列表', async () => {
    const wrapper = mountView()

    await switchTab(wrapper, 'mcp')
    expect(wrapper.get('.placeholder-title').text()).toContain('尚未绑定 MCP 服务')

    await switchTab(wrapper, 'skills')
    expect(wrapper.findAll('.capability')).toHaveLength(6)
  })
})
