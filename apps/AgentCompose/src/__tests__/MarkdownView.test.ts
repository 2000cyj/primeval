import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MarkdownView from '../components/MarkdownView.vue'

/**
 * Markdown 渲染。
 *
 * 桌面端的 webview 不是浏览器 —— 链接不该在应用里导航。
 * 所以渲染出来的链接点了要交给系统浏览器。
 */
const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/api/extensions', () => ({
  openExternal,
}))

describe('MarkdownView', () => {
  it('渲染 Markdown（标题、列表、代码块）', () => {
    const wrapper = mount(MarkdownView, {
      props: { source: '# 标题\n\n- 一项\n\n`代码`' },
    })
    const html = wrapper.html()
    expect(html).toContain('<h1>')
    expect(html).toContain('<li>')
    expect(html).toContain('<code>')
  })

  it('点外部链接交给系统浏览器', async () => {
    openExternal.mockClear()
    const wrapper = mount(MarkdownView, {
      props: { source: '看这里 [示例](https://example.com/docs)' },
      attachTo: document.body,
    })
    const anchor = wrapper.find('a')
    expect(anchor.exists()).toBeTruthy()

    await anchor.trigger('click')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    document.body.innerHTML = ''
  })

  it('相对链接不管（应用内部的）', async () => {
    openExternal.mockClear()
    const wrapper = mount(MarkdownView, {
      props: { source: '[内部](/some/page)' },
      attachTo: document.body,
    })
    await wrapper.find('a').trigger('click')
    expect(openExternal).not.toHaveBeenCalled()
    document.body.innerHTML = ''
  })
})
