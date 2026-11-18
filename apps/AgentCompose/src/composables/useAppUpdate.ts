/**
 * 应用更新状态。
 *
 * # 为什么状态在模块作用域
 *
 * 「系统设置」和「帮助中心」都要显示更新状态，而这两处都会被销毁：
 *
 * - **系统设置**是视图。切换侧边栏时它被 `v-else` 卸载掉 —— 局部 state
 *   跟着一起没了，切回来又变成「未检查」。
 * - **帮助中心**的页签用 naive-ui 的 `NTabPane`，`display-directive` 默认是
 *   `if` —— 切走的页签内容会被销毁重建。
 *
 * 放在模块作用域，两处共享同一份：切来切去都还在；而且**在设置页查过一次，
 * 帮助中心直接显示结果**，不用再发一次网络请求。
 *
 * （这跟 `useSidebar`、`useWindowChrome` 是同一个模式 —— 全应用共用一份状态。）
 */
import { computed, ref } from 'vue'
import {
  checkAppUpdate,
  installUpdateAndRestart,
  onUpdateDownloadProgress,
  type AppUpdateInfo,
  type UpdateDownloadProgress,
} from '@/api/updater'
import { openExternal } from '@/api/extensions'
import { getAppVersion } from '@/api/app'
import { APP_VERSION } from '@/utils/appVersion'
import { formatDateTime } from '@/utils/datetime'

/** 消息提示 —— 只用到 error / success / info 三个方法。 */
type Messenger = {
  error: (message: string) => unknown
  success: (message: string) => unknown
  info: (message: string) => unknown
}

/** 检查的额外选项。 */
type CheckOptions = {
  /**
   * 静默检查。
   *
   * 后台自动查的时候用 —— 查不到就当没查过，不弹提示、不报错。
   * 也不能把**已经查到的状态**弄丢：后台复查失败时，之前查到的
   * 「有新版本」还得留着。
   */
  silent?: boolean
}

/** 检测状态。 */
type UpdateState = 'idle' | 'checking' | 'latest' | 'update'

// ── 全应用共用一份 ──────────────────────────────────────────

/** 当前状态。 */
const updateState = ref<UpdateState>('idle')
/** 检测结果。 */
const updateInfo = ref<AppUpdateInfo | null>(null)
/** 检查失败的说明（界面上也显示一份，不依赖全局消息）。 */
const checkError = ref('')
/** 发布说明是不是展开的。 */
const notesExpanded = ref(false)
/** 正在下载安装。 */
const installing = ref(false)
/** 下载进度（null = 还没开始或已结束）。 */
const downloadProgress = ref<UpdateDownloadProgress | null>(null)
/** 当前版本。 */
const currentVersion = ref(APP_VERSION)

/** 进度监听的取消函数。 */
let unlistenProgress: (() => void) | undefined

/** 有新版本。 */
const hasUpdate = computed(() => updateState.value === 'update')
/** 已是最新。 */
const isLatest = computed(() => updateState.value === 'latest')
/** 最新版本号（没查到就空着）。 */
const latestVersion = computed(() => updateInfo.value?.latestVersion ?? '')
/** 新版本发布说明。 */
const updateNotes = computed(() => updateInfo.value?.notes ?? '')
/** 新版本发布日期（转成能读的本地时间）。 */
const updatePublishedAt = computed(() => formatDateTime(updateInfo.value?.publishedAt ?? ''))

/** 下载百分比（服务端没给总量就不知道，显示不确定态）。 */
const downloadPercent = computed(() => {
  const progress = downloadProgress.value
  if (!progress || progress.total <= 0) return null
  return Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
})

/** 已下载多少 MB。 */
const downloadedMb = computed(() => {
  const progress = downloadProgress.value
  if (!progress) return '0.0'
  return (progress.downloaded / 1024 / 1024).toFixed(1)
})

/** 总共多少 MB。 */
const totalMb = computed(() => {
  const progress = downloadProgress.value
  if (!progress || progress.total <= 0) return ''
  return (progress.total / 1024 / 1024).toFixed(1)
})

/** 断开下载进度监听 —— 别在组件销毁之后还收事件。 */
const cleanupProgress = (): void => {
  unlistenProgress?.()
  unlistenProgress = undefined
}

/** 读当前版本（本地读，不联网）。 */
const loadCurrentVersion = async (): Promise<void> => {
  try {
    const version = await getAppVersion()
    // 后端没给准话就别改 —— 宁可留着编译期常量，也别把版本号显示成空
    if (typeof version === 'string' && version) currentVersion.value = version
  } catch {
    currentVersion.value = APP_VERSION
  }
}

/**
 * 检查最新版本。
 *
 * `options.silent` 为真时：查不到不报错、不弹提示，
 * 且**不会把已经查到的状态弄丢**（后台复查失败时，之前查到的
 * 「有新版本」还得留着）。
 */
const checkLatestVersion = async (message?: Messenger, options?: CheckOptions): Promise<void> => {
  const silent = options?.silent ?? false
  // 记下原来的状态 —— 静默检查失败时要还原回去。
  const previousState = updateState.value
  updateState.value = 'checking'
  checkError.value = ''
  try {
    const info = await checkAppUpdate()
    updateInfo.value = info
    currentVersion.value = info.currentVersion || currentVersion.value
    updateState.value = info.hasUpdate ? 'update' : 'latest'
    if (updateState.value === 'latest' && !silent) {
      message?.success(`当前已是最新版本 ${currentVersion.value}`)
    }
  } catch (error) {
    const text = `检查版本失败：${error instanceof Error ? error.message : String(error)}`
    if (silent) {
      // 静默的 —— 状态还原回去，别把已查到的结果弄丢。
      updateState.value = previousState
      return
    }
    updateState.value = 'idle'
    checkError.value = text
    message?.error(text)
  }
}

/** 开始更新：应用内下载 → 验签 → 安装器接手 → 重启。 */
const startUpdate = async (message?: Messenger): Promise<void> => {
  if (installing.value) return
  installing.value = true
  downloadProgress.value = null
  unlistenProgress = await onUpdateDownloadProgress((progress) => {
    downloadProgress.value = progress
  })
  try {
    const started = await installUpdateAndRestart()
    // Windows 上安装器起来后进程就退出了，走到这里说明没有更新可装
    if (!started) {
      message?.info('当前已是最新版本')
      updateState.value = 'latest'
    }
  } catch (error) {
    message?.error(`更新失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    installing.value = false
    cleanupProgress()
  }
}

/** 打开 Release 页面看完整发布说明。 */
const openReleaseNotes = async (message?: Messenger): Promise<void> => {
  const url = updateInfo.value?.releaseUrl
  if (!url) return
  try {
    await openExternal(url)
  } catch (error) {
    const text = `打不开发布说明：${error instanceof Error ? error.message : String(error)}`
    checkError.value = text
    message?.error(text)
  }
}

/**
 * 重置更新状态。
 *
 * 单独导出 —— 测试里需要在每个用例前清一次（状态是共享的，
 * 上一个用例留下的会串到下一个）。
 */
export const resetUpdateState = (): void => {
  updateState.value = 'idle'
  updateInfo.value = null
  checkError.value = ''
  notesExpanded.value = false
  installing.value = false
  downloadProgress.value = null
  cleanupProgress()
}

/**
 * 用更新状态。
 *
 * 返回的都是**共享**的状态 —— 两处用的是同一份，改一处两处都变。
 */
export const useAppUpdate = () => ({
  // 状态
  updateState,
  updateInfo,
  checkError,
  notesExpanded,
  installing,
  downloadProgress,
  currentVersion,
  hasUpdate,
  isLatest,
  latestVersion,
  updateNotes,
  updatePublishedAt,
  downloadPercent,
  downloadedMb,
  totalMb,
  // 动作
  checkLatestVersion,
  startUpdate,
  openReleaseNotes,
  cleanupProgress,
  loadCurrentVersion,
  resetUpdateState,
})
