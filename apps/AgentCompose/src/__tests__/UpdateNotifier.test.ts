import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { NNotificationProvider } from 'naive-ui'
import UpdateNotifier from '@/components/UpdateNotifier.vue'
import { resetUpdateState, useAppUpdate } from '@/composables/useAppUpdate'
import { resetUpdateNotifier } from '@/composables/useUpdateNotifier'
import { useHelpCenter } from '@/composables/useHelpCenter'

/**
 * 更新提醒：后台查一次，有新版本就在右下角弹一下，
 * 点弹窗跳到系统设置。
 */

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const listenMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

const openUrlMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/extensions', () => ({ openExternal: openUrlMock }))

const updateInfo = {
  currentVersion: '1.0.0',
  latestVersion: '1.2.0',
  hasUpdate: true,
  notes: '修了一些问题',
  publishedAt: '2026-11-13T10:00:00Z',
  releaseUrl: 'https://github.com/2000cyj/primeval/releases/tag/v1.2.0',
  downloadUrl: '',
  portableUrl: '',
}

/** 挂上 provider —— UpdateNotifier 得在它里面（靠 inject 拿 API）。 */
const mountNotifier = () =>
  mount(NNotificationProvider, {
    attachTo: document.body,
    slots: { default: () => h(UpdateNotifier) },
  })

/** 等后台那次异步检查跑完。 */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/** 弹窗里那段可点的内容。 */
const clickable = (): HTMLElement | undefined =>
  Array.from(document.querySelectorAll('div')).find(
    (el) => el.textContent?.includes('点击查看更新详情') && el.style.cursor === 'pointer',
  )

/** 弹窗出现的次数（数弹窗根节点）。 */
const popupCount = (): number => document.querySelectorAll('.n-notification').length

beforeEach(() => {
  resetUpdateState()
  resetUpdateNotifier()
  useHelpCenter().resetHelpCenter()
  invokeMock.mockReset()
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'check_app_update') return Promise.resolve(updateInfo)
    return Promise.resolve([])
  })
  window.location.hash = ''
})

afterEach(() => {
  resetUpdateState()
  resetUpdateNotifier()
  useHelpCenter().resetHelpCenter()
  document.body.innerHTML = ''
  window.location.hash = ''
})

describe('更新提醒', () => {
  it('后台查到新版本，右下角弹一个窗', async () => {
    const wrapper = mountNotifier()
    await flush()

    const text = document.body.textContent ?? ''
    expect(text).toContain('检测到新版本')
    expect(text).toContain('1.2.0')
    expect(text).toContain('点击查看更新详情')

    wrapper.unmount()
  })

  it('点弹窗打开帮助中心的「版本」页签', async () => {
    const wrapper = mountNotifier()
    await flush()

    const target = clickable()
    expect(target).toBeTruthy()

    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    // 帮助中心开了，且停在「版本」页签
    expect(useHelpCenter().helpOpen.value).toBe(true)
    expect(useHelpCenter().helpTab.value).toBe('version')

    wrapper.unmount()
  })

  it('没有新版本就不弹', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') {
        return Promise.resolve({ ...updateInfo, hasUpdate: false, latestVersion: '1.0.0' })
      }
      return Promise.resolve([])
    })

    const wrapper = mountNotifier()
    await flush()

    expect(document.body.textContent ?? '').not.toContain('检测到新版本')

    wrapper.unmount()
  })

  it('同一个版本只弹一次', async () => {
    const first = mountNotifier()
    await flush()
    expect(popupCount()).toBe(1)
    first.unmount()
    document.body.innerHTML = ''

    // 再来一次 —— 同一个版本不该再弹
    const second = mountNotifier()
    await flush()
    expect(popupCount()).toBe(0)

    second.unmount()
  })

  it('后台查失败不弹窗，也不把已查到的状态弄丢', async () => {
    // 先成功查一次 —— 状态应该是「有新版本」
    const first = mountNotifier()
    await flush()
    expect(useAppUpdate().hasUpdate.value).toBe(true)
    first.unmount()

    // 再查的时候网络不通
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') return Promise.reject(new Error('网络不通'))
      return Promise.resolve([])
    })
    resetUpdateNotifier()
    const second = mountNotifier()
    await flush()

    // 状态还在 —— 后台复查失败不能把「有新版本」抹掉
    expect(useAppUpdate().hasUpdate.value).toBe(true)

    second.unmount()
  })
})
