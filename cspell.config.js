// cspell 配置文件
// ponytail: 全仓检查,后续按需加 ignorePaths(生成的代码、第三方包等)
export default {
  // 工作区里常见的占位/噪音词,加入词典避免误报
  words: ['monorepo', 'pnpm', 'eslint', 'prettier', 'vue'],

  // 词典:直接列包名,cspell 会自动加载其 cspell-ext.json
  dictionaries: ['@cspell/dict-lorem-ipsum'],

  // 检查的文件 glob
  include: ['apps/**', 'packages/**', '*.{md,json,js,mjs,cjs,ts,vue}'],
  files: [],
  ignorePaths: [
    '**/node_modules',
    '**/dist',
    '**/build',
    '**/.turbo',
    'pnpm-lock.yaml',
    '**/package-lock.json',
    '**/package.json',
    '**/tsconfig*.json',
  ],
}
