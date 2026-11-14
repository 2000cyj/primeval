import { invoke } from '@tauri-apps/api/core'

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

/** 检查是否有新版本 */
export const checkAppUpdate = (): Promise<AppUpdateInfo> =>
  invoke<AppUpdateInfo>('check_app_update')
