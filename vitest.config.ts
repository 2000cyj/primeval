import { defineConfig } from 'vitest/config'

// 根统一测试配置:jsdom 环境以兼容 Vue 组件测试
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
  },
})
