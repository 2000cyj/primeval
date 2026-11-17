import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WikiPickerModal from '../components/WikiPickerModal.vue'

/**
 * 智能体的 wiki 页面选择弹窗。
 *
 * 绑定的是**入口页面** —— 子页面自动跟着可见，
 * 所以列表里只出现顶层页面和有子页面的页面。
 */
const listWikiPagesMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/wiki', () => ({
  listWikiPages: listWikiPagesMock,
}))

type Meta = {
  slug: string
  title: string
  tags: string[]
  parent: string | null
  createdAt: number
  updatedAt: number
}

const meta = (
  slug: string,
  title: string,
  parent: string | null = null,
  tags: string[] = [],
): Meta => ({
  slug,
  title,
  tags,
  parent,
  createdAt: 0,
  updatedAt: 0,
})

/** 已挂载的 wrapper —— 测完要拆掉。
 *
 * NModal 是 teleport 出去的，不拆的话 DOM 会留在 document 上，
 * 下一个用例的 querySelectorAll 会捡到上一个的残留。
 */
const mounted: { unmount: () => void }[] = []

const mountModal = async (selected: string[] = []) => {
  const wrapper = mount({
    components: { NMessageProvider, WikiPickerModal },
    template: `
      <NMessageProvider>
        <WikiPickerModal
          :show="true"
          :selected="selected"
          @update:selected="onSelect"
          @close="onClose"
        />
      </NMessageProvider>
    `,
    data: () => ({ selected, picked: [] as string[] }),
    methods: {
      onSelect(value: string[]) {
        ;(this as unknown as { picked: string[] }).picked = value
      },
      onClose() {},
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('Wiki 选择弹窗', () => {
  // NModal 是 teleport 出去的 —— 得从 document 上找
  const names = (): string[] =>
    Array.from(document.querySelectorAll('.wiki-name')).map((item) => item.textContent ?? '')

  it('列出顶层页面与有子页面的页面，隐藏纯叶子页', async () => {
    listWikiPagesMock.mockResolvedValue([
      meta('root', '运维'),
      meta('mid', '部署', 'root'),
      meta('leaf', '回滚', 'mid'),
      meta('other', '财务'),
    ])
    await mountModal()
    const texts = names()
    expect(texts).toContain('运维')
    expect(texts).toContain('部署')
    expect(texts).toContain('财务')
    expect(texts).not.toContain('回滚')
  })

  it('勾选时用 wiki/<slug> 引用格式', async () => {
    listWikiPagesMock.mockResolvedValue([meta('root', '运维')])
    const wrapper = await mountModal()
    const option = document.querySelector('.wiki-option') as HTMLElement
    option.click()
    await wrapper.vm.$nextTick()
    const picked = (wrapper.vm as unknown as { picked: string[] }).picked
    expect(picked).toEqual(['wiki/root'])
  })

  it('已选中的页面显示为勾选态，再点一次取消', async () => {
    listWikiPagesMock.mockResolvedValue([meta('root', '运维')])
    const wrapper = await mountModal(['wiki/root'])
    const option = document.querySelector('.wiki-option') as HTMLElement
    expect(option.className).toContain('checked')
    option.click()
    await wrapper.vm.$nextTick()
    const picked = (wrapper.vm as unknown as { picked: string[] }).picked
    expect(picked).toEqual([])
  })

  it('搜索按标题和标签过滤', async () => {
    listWikiPagesMock.mockResolvedValue([
      meta('a', '部署手册', null, ['运维']),
      meta('b', '财务制度', null, ['财务']),
    ])
    const wrapper = await mountModal()
    const input = document.querySelector('input') as HTMLInputElement
    input.value = '运维'
    input.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    expect(names()).toEqual(['部署手册'])
  })

  it('没有页面时给出空态提示', async () => {
    listWikiPagesMock.mockResolvedValue([])
    await mountModal()
    expect(document.querySelector('.wiki-empty')).not.toBeNull()
  })
})
