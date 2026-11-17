import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// 根统一测试配置:jsdom 环境以兼容 Vue 组件测试
export default defineConfig({
  resolve: {
    alias: {
      // Pi 的扩展 API 只存在于 Pi 自己的运行时里，monorepo 里装不上。
      // 测试只需要 CONFIG_DIR_NAME，给个等价的桩就行。
      '@earendil-works/pi-coding-agent': fileURLToPath(
        new URL('./apps/agentspace-cli/assets/pi-coding-agent.stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
    // AgentCompose 有自己的 vitest 配置（要 vue 插件 + `@/` 别名）。
    // 它在根配置里跑不起来 —— 那些用例从 apps/AgentCompose 目录跑。
    exclude: ['**/node_modules/**', 'apps/AgentCompose/**'],
  },
})
