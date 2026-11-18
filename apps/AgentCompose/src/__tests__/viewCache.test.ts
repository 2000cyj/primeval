import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onActivated, ref } from 'vue'
import { KeepAlive } from 'vue'

/**
 * 页面缓存。
 *
 * 页面被 `<KeepAlive>` 缓存着 —— 切走再切回来不会重新挂载，
 * 滚动位置、筛选条件都还在，也不会重新加载一遍数据。
 *
 * 数据变了要重载的话，靠 `dataRevision` 的信号（见 `@/data/dataRevision`）。
 */

describe('页面缓存', () => {
  it('切走再切回来，组件不会重新挂载', async () => {
    let mounted = 0
    let activated = 0
    const CachePage = defineComponent({
      name: 'CachePage',
      setup() {
        mounted += 1
        // KeepAlive 激活缓存实例时会调这个钩子
        onActivated(() => {
          activated += 1
        })
        return () => h('div', '页面内容')
      },
    })

    const which = ref('a')
    const Other = defineComponent({ name: 'OtherPage', setup: () => () => h('div', '别的页面') })
    const Shell = defineComponent({
      name: 'TestShell',
      setup() {
        return () =>
          h(KeepAlive, null, {
            default: () => (which.value === 'a' ? h(CachePage) : h(Other)),
          })
      },
    })

    const wrapper = mount(Shell, { attachTo: document.body })
    await nextTick()
    expect(mounted).toBe(1)

    // 切走
    which.value = 'b'
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(wrapper.text()).toContain('别的页面')

    // 切回来 —— 实例复用，不会重新挂载
    which.value = 'a'
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(wrapper.text()).toContain('页面内容')
    expect(mounted).toBe(1) // 只挂载过一次 —— 缓存生效了
    expect(activated).toBe(2) // 首次 + 切回来
  })
})

describe('数据版本信号', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('改了数据就 +1，没改就不动', async () => {
    const { bumpSkills, skillsRevision } = await import('@/data/dataRevision')
    const before = skillsRevision.value
    expect(skillsRevision.value).toBe(before)
    bumpSkills()
    expect(skillsRevision.value).toBe(before + 1)
  })

  it('各类数据各管各的版本号', async () => {
    const { bumpSkills, skillsRevision, mcpRevision, wikiRevision } =
      await import('@/data/dataRevision')
    const before = {
      skills: skillsRevision.value,
      mcp: mcpRevision.value,
      wiki: wikiRevision.value,
    }

    bumpSkills()
    expect(skillsRevision.value).toBe(before.skills + 1)
    expect(mcpRevision.value).toBe(before.mcp)
    expect(wikiRevision.value).toBe(before.wiki)
  })
})
