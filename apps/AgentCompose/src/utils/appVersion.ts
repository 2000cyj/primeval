/**
 * 应用版本号。
 *
 * 来自 `virtual:app-version` —— 构建脚本从 `src-tauri/tauri.conf.json`
 * 读出来，编进模块里。
 *
 * 为什么不用「运行时问后端」（`@tauri-apps/api/app` 的 `getVersion()`）：
 * 那种做法在 IPC 拿不到时会退化成写死的兜底值，结果是界面上显示一个
 * 跟实际不符的版本号 —— 曾经就显示成 1.0.0，实际装的是 1.0.4。
 * 兜底值一旦写死就会过期 —— 这里干脆没有兜底。
 */
import { APP_VERSION as VERSION } from 'virtual:app-version'

export const APP_VERSION: string = VERSION
