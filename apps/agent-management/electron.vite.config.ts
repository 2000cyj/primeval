import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// 渲染层就在本包内:src/renderer
const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url))

// 生产 CSP:注入构建产物 index.html,开发态不加(Vite HMR 需要内联脚本)
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')
// 注:frame-ancestors 通过 <meta> 下发会被浏览器忽略,这里不写,避免无意义告警

function productionCspMeta(): Plugin {
  return {
    name: 'primeval-desktop-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  main: {
    build: {
      outDir: fileURLToPath(new URL('./out/main', import.meta.url)),
    },
  },
  preload: {
    build: {
      outDir: fileURLToPath(new URL('./out/preload', import.meta.url)),
      // sandbox 下的 preload 不支持 ESM,必须产出 CommonJS
      lib: {
        entry: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)),
        formats: ['cjs'],
      },
      rolldownOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: rendererRoot,
    plugins: [vue(), productionCspMeta()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      },
    },
    build: {
      outDir: fileURLToPath(new URL('./out/renderer', import.meta.url)),
      emptyOutDir: true,
      // electron-vite 默认只在 <包>/src/renderer 下找 index.html,渲染层在 src/renderer 时必须显式指定
      rolldownOptions: {
        input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
      },
    },
    server: {
      // 独立端口,避免与纯 Web dev(dev:web,默认 5173)抢端口
      port: 5174,
      strictPort: true,
    },
  },
})
