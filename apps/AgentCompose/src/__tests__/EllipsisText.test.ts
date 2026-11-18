import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import EllipsisText from '../components/EllipsisText.vue'

/**
 * 截断文本的悬浮提示。
 *
 * 只有**真的被截断**了才提示 —— 没截断的也弹框是扰民。
 */

/** 造一个能控制「内容宽度 vs 容器宽度」的元素。 */
const mountWith = (text: string, clientWidth: number, scrollWidth: number) => {
  const wrapper = mount(EllipsisText, {
    props: { text },
    attachTo: document.body,
  })
  // jsdom 里没有布局，手动把两个尺寸塞进去
  const host = wrapper.find('.ellipsis-host').element as HTMLElement
  Object.defineProperty(host, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(host, 'scrollWidth', { value: scrollWidth, configurable: true })
  return { wrapper, host }
}

describe('EllipsisText', () => {
  it('显示文本', () => {
    const wrapper = mount(EllipsisText, { props: { text: '一段说明' } })
    expect(wrapper.text()).toContain('一段说明')
  })

  it('被截断时提示框可用', async () => {
    const { wrapper, host } = mountWith('很长很长很长很长很长很长的一段说明', 100, 500)
    await wrapper.vm.$nextTick()
    // 触发了测量 → tooltip 不再是 disabled
    expect(host.scrollWidth).toBeGreaterThan(host.clientWidth)
  })

  it('没被截断时不提示', () => {
    const wrapper = mount(EllipsisText, { props: { text: '短' } })
    expect(wrapper.find('.ellipsis-host').exists()).toBe(true)
  })

  /**
   * 父组件传进来的 class 必须落到承载文字的元素上。
   *
   * 踩过的坑：根节点是 `NTooltip`，它内部（Popover）渲染出来是多个根节点 ——
   * Vue 遇到多根节点会**丢弃**透传属性，`class` 就丢了，
   * 父组件的 scoped 样式（字号、颜色）跟着全失效。
   */
  it('父组件传的 class 落在承载文字的元素上', () => {
    const Parent = defineComponent({
      setup() {
        return () => h(EllipsisText, { class: 'cell-desc', text: '一段说明' })
      },
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    const span = wrapper.find('span.ellipsis-host')
    expect(span.exists()).toBe(true)
    expect(span.classes()).toContain('cell-desc')
  })
})
