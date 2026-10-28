import { defineConfig } from 'tsup'

// 库包统一打包配置:ESM + CJS 双格式,产出类型声明
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
})
