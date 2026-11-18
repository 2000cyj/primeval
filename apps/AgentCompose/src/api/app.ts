/**
 * 应用自身的版本号。
 *
 * 问后端要 —— 后端跟打包出来的安装包是同一个版本，是权威来源。
 *
 * 自家的 Tauri 命令不走 ACL 权限，不像 `@tauri-apps/api/app` 的 `getVersion()`
 * 那样可能被权限挡掉；真被挡了还有编译期常量兜底（见 `@/utils/appVersion`），
 * 那个值也是真的，不会过期。
 */
import { invoke } from '@tauri-apps/api/core'

/** 当前应用版本号。 */
export const getAppVersion = (): Promise<string> => invoke<string>('app_version')
