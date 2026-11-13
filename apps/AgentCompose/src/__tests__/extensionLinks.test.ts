import { describe, expect, it } from 'vitest'
import { repoLink } from '../api/extensions'

/**
 * 仓库链接归一化。
 *
 * npm 的 repository 字段五花八门 —— 直接拿来当链接会变成
 * 「下载 .git 文件」而不是打开仓库页。
 */
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
