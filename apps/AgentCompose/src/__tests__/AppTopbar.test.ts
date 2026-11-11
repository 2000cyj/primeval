import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppTopbar from '../components/AppTopbar.vue'
import { useNotifications } from '../composables/useNotifications'

/**
 * 右上角铃铛里的通知记录。
 * 数据来自模块级的通知 store（升级就是往那儿写）。
 */
const { notices, start, finish, setAction, clear } = useNotifications()

/** 落盘命令：没有 Tauri 运行时，mock 掉免得报错 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

/** 当前挂着的顶栏：每个用例结束后要卸掉 */
let wrapper: VueWrapper | null = null

const mountTopbar = async () => {
  wrapper = mount({
    components: { NMessageProvider, AppTopbar },
    template: '<NMessageProvider><AppTopbar /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  invokeMock.mockReset()
  clear()
  document.body.innerHTML = ''
})

describe('顶栏通知', () => {
  it('没有通知时不显示角标', async () => {
    const wrapper = await mountTopbar()

    expect(wrapper.find('.badge').exists()).toBe(false)
  })

  it('有进行中的通知时显示角标，点开能看到记录与状态', async () => {
    const id = start('正在升级 Claude Code', 'npm install -g @anthropic-ai/claude-code@latest')
    const wrapper = await mountTopbar()

    expect(wrapper.get('.badge').text()).toBe('1')

    await wrapper.find('.bell').trigger('click')
    await flushPromises()

    const body = document.body.textContent ?? ''
    expect(body).toContain('正在升级 Claude Code')
    expect(body).toContain('npm install -g @anthropic-ai/claude-code@latest')
    expect(body).toContain('1 项进行中')

    // 升级完成后，通知从「进行中」变成成功
    finish(id, 'success', { detail: '升级完成' })
    await wrapper.vm.$nextTick()

    const after = document.body.textContent ?? ''
    expect(after).toContain('升级完成')
    expect(after).not.toContain('1 项进行中')
  })

  it('通知上的动作（如「重试」）能直接点', async () => {
    let clicked = 0
    const id = start('Claude Code 升级失败', 'EACCES permission denied', 'claude')
    setAction(id, {
      label: '重试',
      run: () => {
        clicked += 1
      },
    })
    const wrapper = await mountTopbar()

    await wrapper.find('.bell').trigger('click')
    await flushPromises()

    const action = document.body.querySelector('.item-action') as HTMLButtonElement
    expect(action).toBeTruthy()
    expect(action.textContent).toBe('重试')

    action.click()
    await flushPromises()
    expect(clicked).toBe(1)
  })

  it('通知可以单独关掉', async () => {
    start('正在升级 Claude Code', 'npm install -g xxx')
    const wrapper = await mountTopbar()

    await wrapper.find('.bell').trigger('click')
    await flushPromises()

    const closeButton = document.body.querySelector('.item-close') as HTMLButtonElement
    expect(closeButton).toBeTruthy()
    closeButton.click()
    await flushPromises()

    expect(notices.value).toHaveLength(0)
    expect(wrapper.find('.badge').exists()).toBe(false)
  })

  it('悬停铃铛出现「通知」提示', async () => {
    const wrapper = await mountTopbar()

    await wrapper.find('.bell').trigger('mouseenter')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 120))
    await wrapper.vm.$nextTick()

    const tooltip = document.body.querySelector('.n-tooltip') as HTMLElement
    expect(tooltip).toBeTruthy()
    expect(tooltip.textContent).toContain('通知')
  })

  it('悬停提示和点击展开面板能共存', async () => {
    start('正在升级 Claude Code', 'npm install -g xxx')
    const wrapper = await mountTopbar()

    // 先悬停
    await wrapper.find('.bell').trigger('mouseenter')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 120))
    await wrapper.vm.$nextTick()

    // 再点击 —— 面板照样得弹出来
    await wrapper.find('.bell').trigger('click')
    await flushPromises()

    const body = document.body.textContent ?? ''
    expect(body).toContain('正在升级 Claude Code')
    expect(body).toContain('清空')
  })
})
