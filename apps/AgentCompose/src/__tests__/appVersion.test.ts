import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_VERSION } from '@/utils/appVersion'

/**
 * 应用版本号。
 *
 * 版本号是**编译期**常量（从 `src-tauri/tauri.conf.json` 注入）——
 * 这样它不会过期，也不会因为运行时取不到而退化成写死的兜底值。
 *
 * 之前就是写死了一个 `1.0.0` 兜底，结果界面上显示 1.0.0、实际装的是 1.0.4。
 * 这条测试就是守住「显示的版本号必须等于 tauri.conf.json 里那个」。
 */
describe('应用版本号', () => {
  it('跟 tauri.conf.json 里的一致', () => {
    // 测试的 cwd 就是包根目录
    const conf = readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8')
    const expected = conf.match(/"version"\s*:\s*"([^"]+)"/)?.[1]
    expect(expected).toBeTruthy()
    expect(APP_VERSION).toBe(expected)
  })

  it('不是兜底值 1.0.0 之外的写死数字', () => {
    // 版本号带三段 —— 真版本号都是 x.y.z
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
