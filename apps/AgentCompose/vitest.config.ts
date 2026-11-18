import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { readAppVersion } from './build/version'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // 跟 vite.config.ts 一样 —— 测试里拿到的版本号也得是真的
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
