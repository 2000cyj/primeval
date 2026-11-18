/**
 * 更新提醒：后台查一次，发现新版本就在右下角弹一下。
 *
 * # 为什么不塞进 useAppUpdate
 *
 * `useAppUpdate` 管的是「更新状态」—— 设置页和帮助中心都要看，
 * 所以状态放在模块作用域共享。
 * 这里管的是「要不要弹窗、点了去哪儿」—— 只跟弹窗本身有关。
 *
 * # 弹窗点了去哪儿
 *
 * 打开**帮助中心的「版本」页签** —— 版本号、更新按钮、发布说明都在那儿。
 *
 * 因为状态是共享的，后台查到的结果，到了那儿直接就有，
 * 不用再查一遍。
 *
 * # 弹窗为什么不自动消失
 *
 * 给了 12 秒，但鼠标移上去就不走了（`keepAliveOnHover`）——
 * 用户正在读的时候不该被抽走。
 */
import { h } from 'vue'
import { useNotification } from 'naive-ui'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { useHelpCenter } from '@/composables/useHelpCenter'

/** 后台复查的间隔：6 小时。 */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 弹窗停留多久（毫秒）。 */
const NOTIFY_DURATION_MS = 12_000

/**
 * 已经弹过的版本号。
 *
 * 同一个版本只弹一次 —— 后台每 6 小时查一次，
 * 每次都弹一个同样的弹窗会烦人。
 */
let notifiedVersion = ''

/**
 * 重置提醒状态。
 *
 * 单独导出 —— 测试里每个用例前清一次（模块作用域的状态会串）。
 */
export const resetUpdateNotifier = (): void => {
  notifiedVersion = ''
}

/**
 * 用更新提醒。
 *
 * **必须在 `NNotificationProvider` 的后代里调** ——
 * `useNotification()` 靠 inject 拿 API，在 provider 外面调会拿不到。
 */
export const useUpdateNotifier = () => {
  const notification = useNotification()
  const { checkLatestVersion, hasUpdate, latestVersion } = useAppUpdate()
  const { openHelp } = useHelpCenter()

  /** 复查的定时器。 */
  let timer: ReturnType<typeof setInterval> | undefined

  /** 打开帮助中心的「版本」页签 —— 更新信息在那儿。 */
  const goToVersionTab = (): void => {
    openHelp('version')
  }

  /** 有新版本就弹一下。 */
  const notifyUpdate = (): void => {
    if (!hasUpdate.value) return
    const version = latestVersion.value
    if (!version || version === notifiedVersion) return
    notifiedVersion = version

    // naive-ui 的弹窗没有 onClick —— 把内容做成可点的。
    let handle: { destroy: () => void } | null = null
    const onClick = (): void => {
      handle?.destroy()
      goToVersionTab()
    }

    handle = notification.create({
      type: 'info',
      title: '检测到新版本',
      // 内容得给函数 —— naive-ui 的 content 只收字符串或渲染函数。
      content: () =>
        h(
          'div',
          {
            style: 'cursor: pointer; line-height: 1.6;',
            onClick,
          },
          [
            h('div', `AgentSpace ${version} 已经发布`),
            h(
              'div',
              { style: 'opacity: 0.65; font-size: 12px; margin-top: 2px;' },
              '点击查看更新详情',
            ),
          ],
        ),
      meta: '点一下看版本页',
      duration: NOTIFY_DURATION_MS,
      keepAliveOnHover: true,
    })
  }

  /**
   * 后台查一次 —— 静默的。
   *
   * 查不到就当没查过，不打扰人。
   */
  const checkInBackground = async (): Promise<void> => {
    await checkLatestVersion(undefined, { silent: true })
    notifyUpdate()
  }

  /** 启动：查一次，之后每隔 6 小时再查。 */
  const init = (): void => {
    void checkInBackground()
    timer = setInterval(() => {
      void checkInBackground()
    }, RECHECK_INTERVAL_MS)
  }

  /** 收摊 —— 别让定时器在组件销毁后还活着。 */
  const dispose = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { init, dispose, checkInBackground, notifyUpdate, goToVersionTab }
}
