import { defineConfig } from 'tsup'

// 库包统一打包配置:ESM + CJS 双格式,产出类型声明。
// 每个工具单独入口 —— 对应 package.json 的子路径导出（@remote/utils/is 等），
// 让消费方按需 import、tree-shaking 更干净，也避免 is/validate 同名导出在总 barrel 里冲突。
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/is.ts',
    'src/validate.ts',
    'src/scroll-to.ts',
    'src/cron.ts',
    'src/propTypes.ts',
    'src/formatTime.ts',
    'src/jsencrypt.ts',
    'src/errorCode.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
})
