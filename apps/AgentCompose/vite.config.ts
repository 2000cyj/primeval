import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { readAppVersion } from './build/version'

/**
 * 应用版本号（编译期常量）。
 *
 * 从 `src-tauri/tauri.conf.json` 读出来注入成 `__APP_VERSION__` ——
 * 前端拿到的永远是真版本，不会出现「运行时取不到就退化成写死的兜底值」，
 * 结果界面上显示一个跟实际不符的版本号。
 */
const appVersion = readAppVersion()

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5176, strictPort: true },
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
})
