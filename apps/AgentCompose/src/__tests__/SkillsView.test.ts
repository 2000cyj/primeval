import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SkillsView from '../views/SkillsView.vue'

describe('SkillsView', () => {
  it('点击状态开关会切换该行的启用状态', async () => {
    const wrapper = mount(SkillsView, { global: { stubs: { Transition: false } } })
    const firstRow = wrapper.findAll('.skill-row')[0]
    const toggle = firstRow.get('button[role="switch"]')

    expect(toggle.attributes('aria-checked')).toBe('true')

    await toggle.trigger('click')
    await wrapper.vm.$nextTick()

    expect(
      wrapper.findAll('.skill-row')[0].get('button[role="switch"]').attributes('aria-checked'),
    ).toBe('false')
  })

  it('搜索会过滤列表，空结果时展示空状态', async () => {
    const wrapper = mount(SkillsView)
    const input = wrapper.get('input[aria-label="按名称搜索"]')

    await input.setValue('不存在的技能名称')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.skill-row')).toHaveLength(0)
    expect(wrapper.get('.empty').text()).toContain('没有找到匹配的 Skill')
  })

  it('搜索命中时只保留匹配的技能', async () => {
    const wrapper = mount(SkillsView)
    const input = wrapper.get('input[aria-label="按名称搜索"]')

    await input.setValue('知识库')
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('.skill-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('知识库检索')
  })
})
