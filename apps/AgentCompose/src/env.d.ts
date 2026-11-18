/**
 * 虚拟模块 `virtual:app-version` 的类型声明。
 *
 * 模块内容由构建脚本生成（见 `build/appVersionPlugin.ts`）——
 * 导出当前应用版本号，值来自 `src-tauri/tauri.conf.json`。
 */
declare module 'virtual:app-version' {
  /** 当前应用版本号。 */
  export const APP_VERSION: string
}
