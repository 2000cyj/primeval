import { describe, expect, it } from 'vitest'
import { disableBrowserFeatures, isBrowserShortcut } from '@/composables/useBrowserFeatures'

/**
 * 浏览器特性拦截。
 *
 * 桌面端不该像个浏览器 —— 右键菜单、Ctrl+P / Ctrl+F / F12 这些都得拦掉。
 */

/** 造一个键盘事件。 */
const keyEvent = (
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {},
): KeyboardEvent =>
  ({
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  }) as KeyboardEvent

describe('浏览器快捷键识别', () => {
  it('拦打印 / 查找 / 保存 / 刷新', () => {
    expect(isBrowserShortcut(keyEvent('p', { ctrlKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('f', { ctrlKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('s', { ctrlKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('r', { ctrlKey: true }))).toBe(true)
  })

  it('拦开发者工具（F12 / Ctrl+Shift+I）—— 发布版', () => {
    expect(isBrowserShortcut(keyEvent('F12'), false)).toBe(true)
    expect(isBrowserShortcut(keyEvent('i', { ctrlKey: true, shiftKey: true }), false)).toBe(true)
  })

  it('开发者工具在开发版保留 —— 调试要看', () => {
    expect(isBrowserShortcut(keyEvent('F12'), true)).toBe(false)
    expect(isBrowserShortcut(keyEvent('i', { ctrlKey: true, shiftKey: true }), true)).toBe(false)
    expect(isBrowserShortcut(keyEvent('i', { ctrlKey: true }), true)).toBe(false)
  })

  it('拦新标签页 / 新窗口 / 关闭窗口', () => {
    expect(isBrowserShortcut(keyEvent('t', { ctrlKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('n', { ctrlKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('w', { ctrlKey: true }))).toBe(true)
  })

  it('拦后退 / 前进（Alt+左右）', () => {
    expect(isBrowserShortcut(keyEvent('ArrowLeft', { altKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('ArrowRight', { altKey: true }))).toBe(true)
  })

  it('不拦复制粘贴 —— 应用里要用', () => {
    expect(isBrowserShortcut(keyEvent('c', { ctrlKey: true }))).toBe(false)
    expect(isBrowserShortcut(keyEvent('v', { ctrlKey: true }))).toBe(false)
    expect(isBrowserShortcut(keyEvent('a', { ctrlKey: true }))).toBe(false)
  })

  it('不拦 Ctrl+B —— 应用自己的快捷键（收起侧边栏）', () => {
    expect(isBrowserShortcut(keyEvent('b', { ctrlKey: true }))).toBe(false)
  })

  it('不拦普通按键', () => {
    expect(isBrowserShortcut(keyEvent('a'))).toBe(false)
    expect(isBrowserShortcut(keyEvent('Enter'))).toBe(false)
    expect(isBrowserShortcut(keyEvent('Escape'))).toBe(false)
  })

  it('修饰键要对得上 —— Ctrl+Shift+R 拦，单独 R 不拦', () => {
    expect(isBrowserShortcut(keyEvent('r', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isBrowserShortcut(keyEvent('r'))).toBe(false)
  })
})

describe('拦截器', () => {
  it('右键菜单被取消', () => {
    const cleanup = disableBrowserFeatures()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    cleanup()
  })

  it('浏览器快捷键被取消', () => {
    const cleanup = disableBrowserFeatures()
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    cleanup()
  })

  it('清理之后不再拦截', () => {
    const cleanup = disableBrowserFeatures()
    cleanup()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
