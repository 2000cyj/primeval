/**
 * 应用版本号。
 *
 * **编译期定死** —— `vite.config.ts` 从 `src-tauri/tauri.conf.json` 读出来，
 * 通过 `define` 注入成 `__APP_VERSION__`。
 *
 * 为什么不用「运行时问后端」（`@tauri-apps/api/app` 的 `getVersion()`）：
 * 那种做法在 IPC 拿不到时会退化成写死的兜底值，结果是界面上显示一个
 * 跟实际不符的版本号 —— 曾经就显示成 1.0.0，实际装的是 1.0.4。
 * 兜底值写死就会过期，这里干脆不给兜底。
 */
export const APP_VERSION: string = __APP_VERSION__
