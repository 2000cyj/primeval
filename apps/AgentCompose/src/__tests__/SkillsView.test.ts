import { mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { describe, expect, it } from 'vitest'
import SkillsView from '../views/SkillsView.vue'

const mountView = () =>
  mount({
    components: { NMessageProvider, SkillsView },
    template: '<NMessageProvider><SkillsView /></NMessageProvider>',
  })

const rows = (wrapper: ReturnType<typeof mountView>) => wrapper.findAll('.skill-row')

describe('SkillsView', () => {
  it('渲染全部 Skill 行', () => {
    const wrapper = mountView()
    expect(rows(wrapper)).toHaveLength(20)
  })

  it('切换状态开关会更新该行的 aria-checked', async () => {
    const wrapper = mountView()
    const toggle = rows(wrapper)[0].get('.n-switch')
    expect(toggle.attributes('aria-checked')).toBe('true')

    await toggle.trigger('click')
    await wrapper.vm.$nextTick()

    expect(rows(wrapper)[0].get('.n-switch').attributes('aria-checked')).toBe('false')
  })

  it('搜索会过滤表格，空结果时展示空状态', async () => {
    const wrapper = mountView()
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
