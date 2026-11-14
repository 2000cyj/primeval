import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import HelpModal from '../components/HelpModal.vue'

/**
 * 帮助中心弹窗。
 *
 * 两块内容：命令行操作 + 界面说明。都能搜。
 *
 * NModal 是 teleport 到 body 的 —— 元素不在 wrapper 里，
 * 所以查询一律走 document。
 */
const mountModal = async () => {
  const wrapper = mount(HelpModal, {
    props: { show: true },
    attachTo: document.body,
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

const bodyText = (): string => document.body.textContent ?? ''

/** 切到某个页签 */
const switchTab = async (index: number): Promise<void> => {
  const tabs = document.querySelectorAll<HTMLElement>('.n-tabs-tab')
  tabs[index]?.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 在搜索框里打字 */
const type = async (text: string): Promise<void> => {
  const input = document.querySelector<HTMLInputElement>('.help-modal input')
  if (!input) throw new Error('找不到搜索框')
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('帮助中心', () => {
  it('列出全部命令行分组', async () => {
    await mountModal()
    const text = bodyText()
    expect(text).toContain('命令行')
    expect(text).toContain('智能体')
    expect(text).toContain('Skill 仓库')
    expect(text).toContain('MCP server')
    expect(text).toContain('Pi 扩展')
    expect(text).toContain('本机 CLI 工具箱')
    expect(text).toContain('全局出站代理')
  })

  it('列出 run / install / update 三个起智能体的命令', async () => {
    await mountModal()
    const text = bodyText()
    expect(text).toContain('run <名称>')
    expect(text).toContain('install <名称>')
    expect(text).toContain('update <名称>')
  })

  it('界面页签里有各页面的说明', async () => {
    await mountModal()
    await switchTab(1)

    const text = bodyText()
    expect(text).toContain('MCP 管理')
    expect(text).toContain('Pi 扩展')
    expect(text).toContain('系统设置')
    expect(text).toContain('通用约定')
  })

  it('搜索能过滤命令', async () => {
    await mountModal()
    await type('proxy')

    const text = bodyText()
    // 命中的还在
    expect(text).toContain('proxy')
    // 不相关的分组被过滤掉了
    expect(text).not.toContain('本机 CLI 工具箱')
  })

  it('搜不到时给空态', async () => {
    await mountModal()
    await type('zzzz-不存在的东西')

    expect(bodyText()).toContain('没有匹配的命令')
  })

  it('分组名命中时该组命令全部保留', async () => {
    await mountModal()
    await type('全局出站代理')

    const text = bodyText()
    expect(text).toContain('proxy get')
    expect(text).toContain('proxy set')
    expect(text).toContain('proxy scan')
  })
})
