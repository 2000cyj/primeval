import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import FilterMenu from '../components/FilterMenu.vue'

/**
 * 筛选器（漏斗按钮 → 弹出菜单 → 二级菜单）。
 *
 * 重点：二级菜单往哪边飞。
 *
 * 筛选按钮在工具栏最右边 —— 二级菜单默认往右飞会直接飞出窗口，
 * 用户只看到「使用状态 / 数据来源 / 被谁使用」三个标题，
 * 真正的选项（启用 / 停用、哪个 agent……）全在屏幕外。
 */

const groups = [
  {
    key: 'status',
    label: '使用状态',
    options: [
      { value: 'on', label: '启用', count: 3 },
      { value: 'off', label: '停用', count: 1 },
    ],
  },
  {
    key: 'source',
    label: '数据来源',
    options: [{ value: 'github', label: 'GitHub 仓库', count: 4 }],
  },
]

/** jsdom 没有真实布局 —— 手工摆一个「面板右边缘在哪」 */
const stubPanelRect = (right: number): void => {
  const panel = document.querySelector('.filter-menu') as HTMLElement | null
  if (!panel) return
  panel.getBoundingClientRect = () =>
    ({
      right,
      left: right - 168,
      top: 0,
      bottom: 0,
      width: 168,
      height: 0,
      x: right - 168,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

/** 改窗口宽度（innerWidth 是只读的，得用 defineProperty） */
const stubViewportWidth = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
}

/** 打开筛选器，返回面板元素 */
const openMenu = async (panelRight: number, viewportWidth: number) => {
  stubViewportWidth(viewportWidth)

  const wrapper = mount(
    {
      components: { FilterMenu },
      template: '<FilterMenu v-model="filters" :groups="groups" />',
      data: () => ({ filters: {} }),
      setup: () => ({ groups }),
    },
    { attachTo: document.body },
  )
  await flushPromises()

  // 弹层默认不渲染 —— 点一下漏斗按钮才出来
  await wrapper.find('button').trigger('click')
  await flushPromises()

  stubPanelRect(panelRight)

  // 悬停某个维度 —— 组件在那儿量位置
  const group = document.querySelector('.filter-group') as HTMLElement
  group.dispatchEvent(new MouseEvent('mouseenter'))
  await flushPromises()

  return wrapper
}

/** 当前面板的方向类名 */
const side = (): string => {
  const panel = document.querySelector('.filter-menu')
  return panel?.classList.contains('submenu-left') ? 'left' : 'right'
}

afterEach(() => {
  document.body.innerHTML = ''
  stubViewportWidth(1024)
})

describe('筛选器二级菜单的方向', () => {
  it('右边放不下就往左飞', async () => {
    // 面板右边缘贴着窗口右边（1200）—— 右边只剩 0 像素
    await openMenu(1200, 1200)

    expect(side()).toBe('left')
  })

  it('右边够就往右飞', async () => {
    // 面板右边缘在 700 —— 右边还有 500 像素，够用
    await openMenu(700, 1200)

    expect(side()).toBe('right')
  })

  it('悬停另一个维度时会重新量一次位置', async () => {
    await openMenu(1200, 1200)
    expect(side()).toBe('left')

    // 面板挪到中间了 —— 右边又够了
    stubPanelRect(600)
    const groups = document.querySelectorAll('.filter-group')
    groups[1]?.dispatchEvent(new MouseEvent('mouseenter'))
    await flushPromises()

    expect(side()).toBe('right')
  })
})
