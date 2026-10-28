// commitlint 配置：使用 conventional commits 规范
// 配合 husky 的 commit-msg 钩子，提交时校验 message 格式
export default {
  // 继承 conventional config
  extends: ['@commitlint/config-conventional'],
  // 启用 cz-git 提供的中文 prompt 适配（不强制，但允许 emoji 等扩展）
  prompt: {
    alias: {
      fd: 'docs: fix typos', // 文档修复的快速别名
    },
  },
}
