/**
 * `@earendil-works/pi-coding-agent` 的测试桩。
 *
 * 这个包只存在于 Pi 自己的运行时里 —— monorepo 里装不上。
 * 但扩展里要用到 `CONFIG_DIR_NAME`（项目配置目录名），
 * 测试环境里给个等价的常量就行。
 *
 * 真正的值由 Pi 决定：官方发行版是 `.pi`。
 */

/** 项目配置目录名。 */
export const CONFIG_DIR_NAME = '.pi'

/** 扩展 API —— 测试里用不到具体实现，只用来满足类型。 */
export type ExtensionAPI = {
  on: (event: string, handler: (...args: never[]) => unknown) => void
  registerTool: (tool: unknown) => void
  registerCommand: (name: string, options: unknown) => void
  registerShortcut: (keys: string, options: unknown) => void
  registerFlag: (name: string, options: unknown) => void
}

/** 扩展上下文 —— 测试里用不到具体实现。 */
export type ExtensionContext = {
  cwd: string
  hasUI: boolean
  mode: string
}
