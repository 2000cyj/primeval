import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkbenchView from '../views/WorkbenchView.vue'

describe('WorkbenchView', () => {
  it('默认展示 Claude Code 已绑定的 6 个 skills', () => {
    const wrapper = mount(WorkbenchView)

    expect(wrapper.get('.detail-name').text()).toBe('Claude Code')
    expect(wrapper.get('.total').text()).toBe('共 6 skills')
    expect(wrapper.findAll('.skill-card')).toHaveLength(6)
  })

  it('切换智能体后，已绑定 skills 列表随之变化', async () => {
    const wrapper = mount(WorkbenchView)
    const geminiItem = wrapper
      .findAll('.agent-item')
      .find((item) => item.text().includes('Gemini CLI'))

    await geminiItem?.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.detail-name').text()).toBe('Gemini CLI')
    expect(wrapper.get('.total').text()).toBe('共 5 skills')
    expect(wrapper.findAll('.skill-card')).toHaveLength(5)
  })

  it('切换到 MCP 标签页显示空状态，切回 Skills 恢复列表', async () => {
    const wrapper = mount(WorkbenchView)

    await wrapper.get('#tab-mcp').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('#panel-mcp').exists()).toBe(true)
    expect(wrapper.get('.empty').text()).toContain('尚未绑定 MCP 服务')

    await wrapper.get('#tab-skills').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('#panel-skills').exists()).toBe(true)
    expect(wrapper.findAll('.skill-card')).toHaveLength(6)
  })
})
