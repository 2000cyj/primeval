/**
 * 应用自身的版本检测与更新。
 *
 * 后端去问 GitHub 的 latest release，比对本地版本。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * 应用自身的版本检测。
 *
 * 后端去问 GitHub 的 latest release，比对本地版本。
 */
export interface AppUpdateInfo {
  /** 当前版本 */
  currentVersion: string
  /** 远端最新版本 */
  latestVersion: string
  /** 远端是否比当前新 */
  hasUpdate: boolean
  /** 新版本发布说明 */
  notes: string
  /** 新版本发布日期 */
  publishedAt: string
  /** Release 页面地址 */
  releaseUrl: string
  /** Windows 安装包地址 */
  downloadUrl: string
  /** 便携版地址 */
  portableUrl: string
}

/** 下载进度 */
export interface UpdateDownloadProgress {
  /** 已下载字节 */
  downloaded: number
  /** 总字节（0 表示未知） */
  total: number
}

/** 检查是否有新版本 */
export const checkAppUpdate = (): Promise<AppUpdateInfo> =>
  invoke<AppUpdateInfo>('check_app_update')

/**
 * 下载并安装更新。
 *
 * 全程在应用内完成：后端下载 → 验签 → 交给 NSIS 装好 → 重启。
 * 不再打开浏览器。
 *
 * Windows 上安装器起来后进程会退出，所以这个 Promise 往往不会 resolve ——
 * 正常的表现是「应用重启了」。
 *
 * @returns 有新版并已开始安装返回 true；已是最新返回 false
 */
export const installUpdateAndRestart = (): Promise<boolean> =>
  invoke<boolean>('install_update_and_restart')

/**
 * 监听下载进度。
 *
 * @returns 取消监听的函数
 */
export const onUpdateDownloadProgress = (
  handler: (progress: UpdateDownloadProgress) => void,
): Promise<UnlistenFn> =>
  listen<UpdateDownloadProgress>('update-download-progress', (event) => {
    handler(event.payload)
  })
