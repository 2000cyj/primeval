// ESLint 扁平配置（flat config，ESLint v9+）
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import configPrettier from 'eslint-config-prettier'

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Figma 下载的页面源码（figma-home.js 是打包后的第三方 JS，不可 lint/format）
      '**/.claude/figma-home.js',
      '**/.claude/figma-home-full.gif',
      '**/.claude/figma-home-index.json',
      '**/.claude/figma-*.png',
    ],
  },

  // JS 推荐规则
  js.configs.recommended,

  // TypeScript 推荐规则
  ...tseslint.configs.recommended,

  // Vue3 推荐规则（.vue 文件）
  ...pluginVue.configs['flat/recommended'],

  // 库包（packages/*）严格规则：对外发布，类型与导出需更克制
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      // 禁用 any，库的公共 API 必须有明确类型
      '@typescript-eslint/no-explicit-any': 'error',
      // 导出的函数/类需显式标注返回类型和边界类型
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // 未使用变量报错（下划线前缀除外）
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 禁止非空断言，库内应显式处理空值
      '@typescript-eslint/no-non-null-assertion': 'error',
      // 用 import type 导入纯类型，避免运行时冗余导入
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // 从 admin app 迁入的兼容层工具（yudao / 若依 源码搬运）：大量 any、非空断言、
  // 无显式返回类型是原样保留的历史写法，逐步收敛前先放宽，避免为搬运而重写。
  {
    files: ['packages/utils/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      // 校验正则原样搬自若依，字符类里的 \[ 冗余转义无害，不为搬运而改写正则
      'no-useless-escape': 'off',
    },
  },

  // 共享 Vue 组件包（packages/components）：.vue 里的 <script lang="ts"> 需交给 ts 解析器，
  // 否则 packages/**/*.ts 块把它当纯 TS 解析，遇到 <script setup> 语法会 Parsing error。
  {
    files: ['packages/components/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        HTMLElement: 'readonly',
      },
    },
    rules: {
      // 组件目录入口 index.vue / 单概念组件名（Dialog/Echart 等）在库里是约定，不构成冲突 → 警告
      'vue/multi-word-component-names': 'warn',
      // 迁入组件运行时声明 props、any 兜底沿用 app 写法，逐步收敛前放宽
      'vue/define-props-declaration': 'warn',
      'vue/require-default-prop': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Vue3 应用（apps/* Vue 项目）规则：适配 Vue3 + TS 组合式 API + unplugin-auto-import
  // unplugin-auto-import 把 ref/reactive/useRoute/ElButton 等全部注入为全局，
  // vue-eslint-parser 不感知这些全局名，所以这里补齐浏览器+Vue+Node 全局 + 关掉 no-undef；
  // 类型层仍由 vue-tsc 把守，真用了不存在的标识符会在 build 时暴露。
  {
    files: ['apps/vue/**/*.{ts,tsx,vue,js}', 'apps/remote-control-vue3/**/*.{ts,tsx,vue,js}'],
    languageOptions: {
      // .vue 文件中的 <script lang="ts"> 交给 ts 解析器处理
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        // 浏览器运行时全局
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Image: 'readonly',
        // Vue 3 运行时 API（unplugin-auto-import 也注入，但 vue-eslint-parser 看不到）
        resolveComponent: 'readonly',
        resolveDirective: 'readonly',
        // Node 端（vite.config / scripts）需要
        process: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      // ref / reactive / useRoute 等均由 unplugin-auto-import 注入，关掉避免误报
      'no-undef': 'off',
      // 组件名强制多词在 admin 模板里过于严苛（day/hour/min、Dialog、Echart 等都是
      // 业务单概念，HTML 元素集合里没有同名标签，不会冲突）→ 警告而非阻塞
      'vue/multi-word-component-names': 'warn',
      // 强制使用组合式 API 风格
      'vue/component-api-style': ['error', ['script-setup', 'composition']],
      // defineProps 鼓励类型声明，但运行时声明也是合法 Vue 3 语法 → 警告
      'vue/define-props-declaration': 'warn',
      // props 默认值：必填可代替默认 → 警告
      'vue/require-default-prop': 'warn',
      // 表单组件常把 formData 作为 prop 直接 mutate（admin 模板写法），全量重构成本高
      // → 警告，逐步替换为 emit('update:xxx') / v-model:xxx
      'vue/no-mutating-props': 'warn',
      // 应用层可用 any 但需警告，逐步收敛
      '@typescript-eslint/no-explicit-any': 'warn',
      // 未使用变量：admin 模板里有大量未使用的回调形参（key/props/emit/from/vnode/rule 等），
      // 关掉形参/错误形参检查，仅对显式的局部变量与导入报警（解构里未用的属性也不报）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'none',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // Vue 文件里的未使用变量：仅支持下划线前缀模式
      'vue/no-unused-vars': ['error', { ignorePattern: '^_' }],
      // 允许空 catch / 空函数体（admin 模板兜底分支常这样写）
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 关闭：表单调 generateRender 等函数式链式调用是合法表达式
      '@typescript-eslint/no-unused-expressions': 'off',
      // 关闭：正则里的 \" \\d \" 类转义在某些规则引擎下被误报
      'no-useless-escape': 'off',
      // 关闭：临时自赋值（a = a）在链式赋值里有意义
      'no-useless-assignment': 'off',
      // 允许 @ts-ignore / @ts-nocheck 带说明文字（admin 模板常见于类型兜底）
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-nocheck': 'allow-with-description',
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 4,
        },
      ],
    },
  },

  // 根组件 App.vue 豁免多词组件名规则（Vue 官方脚手架惯例）
  {
    files: ['apps/vue/src/App.vue', 'apps/remote-control-vue3/src/App.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  // 路由懒加载约定：views/**/index.vue 是路由入口文件名，单词 "index" 不构成冲突，
  // 整体豁免多词组件名规则
  {
    files: ['apps/**/views/**/index.vue', 'apps/**/views/**/index.ts'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  // apps 下的 Node 端 .mjs 脚本（vite.config.ts / scripts/*.mjs）需要 Node 全局
  {
    files: ['apps/**/vite.config.ts', 'apps/**/scripts/**/*.{js,mjs,ts}', 'apps/**/vite/**/*.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // Node 端不涉及 Vue 配置，可关掉 vue 规则避免无关误报
      'vue/multi-word-component-names': 'off',
      'vue/define-props-declaration': 'off',
      'vue/require-default-prop': 'off',
      'vue/no-mutating-props': 'off',
      // 脚本里 process.env 强类型处理是另一回事，禁用即可
      'no-undef': 'off',
    },
  },

  // 关闭与 Prettier 冲突的格式化类规则（必须放最后）
  configPrettier,
)
