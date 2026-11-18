/**
 * 应用版本号的虚拟模块。
 *
 * 为什么不用 `define` 注入：Vite 8 的 `vite:define` 插件在 **client 环境
 * 直接 return**（`if (this.environment.config.consumer === "client") return;`），
 * 也就是说 `define` 只在**构建**时替换，开发服务器里原样保留 ——
 * 那个标识符在浏览器里是未定义的，运行时直接 ReferenceError。
 *
 * 虚拟模块两边都管用：开发服务器直接吐出带字面量的模块，构建时被打进产物。
 *
 * 版本号只有一个来源：`src-tauri/tauri.conf.json`。
 */
import { readAppVersion } from './version'

/** 虚拟模块的 id。 */
export const APP_VERSION_MODULE_ID = 'virtual:app-version'
/** 解析后的内部 id（`\0` 前缀是 vite 约定的「虚拟模块」标记）。 */
const RESOLVED_ID = `\0${APP_VERSION_MODULE_ID}`

/** vite 插件 —— 提供 `virtual:app-version`。 */
export const appVersionPlugin = {
  name: 'agent-space:app-version',
  resolveId(id: string): string | undefined {
    return id === APP_VERSION_MODULE_ID ? RESOLVED_ID : undefined
  },
  load(id: string): string | undefined {
    if (id !== RESOLVED_ID) return undefined
    return `export const APP_VERSION = ${JSON.stringify(readAppVersion())}\n`
  },
}
