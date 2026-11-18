/**
 * 从 `src-tauri/tauri.conf.json` 读应用版本号。
 *
 * **构建期**用：`vite.config.ts` 把它注入成 `__APP_VERSION__`，
 * 前端编译进去 —— 版本号不会过期，也不会因为运行时取不到而显示错。
 *
 * 构建脚本（`vite.config.ts` / `vitest.config.ts`）共用这一份读取逻辑，
 * 两边拿到的版本号必须一致。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/** 读应用版本号。 */
export const readAppVersion = (): string => {
  const conf = readFileSync(
    fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)),
    'utf-8',
  )
  // tauri.conf.json 允许带注释 —— 正则比 JSON.parse 稳
  const matched = conf.match(/"version"\s*:\s*"([^"]+)"/)
  return matched?.[1] ?? '0.0.0'
}
