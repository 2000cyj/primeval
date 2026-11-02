import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri 约定:前端在包根(index.html + src/),产物输出 dist/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri 期望固定的开发端口(与 src-tauri/tauri.conf.json 的 devUrl 一致)
  server: {
    port: 5175,
    strictPort: true,
  },
  clearScreen: false,
})
