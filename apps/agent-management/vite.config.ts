import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 纯 Web 调试入口:同一份渲染层源码跑在浏览器里(dev:web),不经过 Electron 壳。
// 桌面端请用 pnpm dev(electron-vite dev)。
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
    },
  },
})
