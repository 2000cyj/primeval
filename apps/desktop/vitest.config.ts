import { defineConfig } from 'vitest/config'

// 桌面壳包自己的测试配置:主进程 / preload 逻辑跑在 Node 环境,
// 与根 vitest.config.ts(全局 jsdom)分开,便于 turbo 按包独立执行 test 任务。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
