import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternal, repoLink } from '../api/extensions'

/**
 * 仓库外链。
 *
 * 桌面端的 webview 会把普通链接拦下来 —— 必须走 Tauri 命令
 * 让系统浏览器打开。所以「跳转」这件事得落在命令上。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

afterEach(() => {
  invokeMock.mockReset()
})

describe('仓库链接归一化', () => {
  it('去掉 git+ 前缀和 .git 后缀', () => {
    expect(repoLink('git+https://github.com/foo/bar.git')).toBe('https://github.com/foo/bar')
  })

  it('git:// 换成 https://', () => {
    expect(repoLink('git://github.com/foo/bar.git')).toBe('https://github.com/foo/bar')
  })

  it('git@ 短写换成 https://', () => {
    expect(repoLink('git@github.com:foo/bar.git')).toBe('https://github.com/foo/bar')
  })

  it('本来就是干净地址的不动', () => {
    expect(repoLink('https://github.com/foo/bar')).toBe('https://github.com/foo/bar')
  })

  it('两边的空白也去掉', () => {
    expect(repoLink('  git+https://github.com/foo/bar.git  ')).toBe('https://github.com/foo/bar')
  })
})

describe('打开外部链接', () => {
  it('走 Tauri 命令让系统浏览器打开', async () => {
    invokeMock.mockResolvedValue(undefined)

    await openExternal('https://github.com/foo/bar')

    expect(invokeMock).toHaveBeenCalledWith('mcp_open_url', {
      url: 'https://github.com/foo/bar',
    })
  })

  it('打开失败时抛出带原因的错', async () => {
    invokeMock.mockRejectedValue(new Error('网址不合法'))

    await expect(openExternal('not-a-url')).rejects.toThrow('打开浏览器失败')
  })
})
