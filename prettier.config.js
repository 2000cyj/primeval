// Prettier 全局格式化配置
/** @type {import('prettier').Config} */
export default {
  semi: false, // 不加分号
  singleQuote: true, // 使用单引号
  printWidth: 100, // 每行最大宽度
  tabWidth: 2, // 缩进 2 空格
  trailingComma: 'all', // 多行时尾随逗号
  endOfLine: 'lf', // 统一使用 LF 换行
  arrowParens: 'always', // 箭头函数参数始终带括号
  bracketSpacing: true, // 对象大括号内侧留空格 { foo }
  quoteProps: 'as-needed', // 对象属性仅在必要时加引号
  vueIndentScriptAndStyle: false, // Vue SFC 的 <script>/<style> 顶层不额外缩进
  htmlWhitespaceSensitivity: 'css', // 按 CSS display 属性处理 HTML 空白
  singleAttributePerLine: false, // 单个属性不强制换行

  overrides: [
    {
      // JSON 保留双引号，不用尾随逗号（避免部分解析器报错）
      files: '*.json',
      options: { singleQuote: false, trailingComma: 'none' },
    },
    {
      // Markdown 保留换行语义，避免自动折行破坏排版
      files: '*.md',
      options: { proseWrap: 'preserve' },
    },
  ],
}
