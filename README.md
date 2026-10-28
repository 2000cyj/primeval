# remote-monorepo

基于 **pnpm workspace** 的 monorepo,统一管理一个 Vue 应用与若干共享库包,集成构建、类型检查、测试、版本发布、提交规范与代码规范的全套本地工具链。

> **当前状态**:工具链已完整闭环,所有 `pnpm build/typecheck/test/lint` 均可直接运行。库包和应用代码目前仍是占位,后续替换为真实代码时只需更新对应 `src/` 即可。

---

## 一、技术栈一览

| 分类       | 选型                       | 版本             | 作用                                  |
| ---------- | -------------------------- | ---------------- | ------------------------------------- |
| 运行时     | Node.js                    | `>=22.18.0`      | 由 `engines` + `engine-strict` 强制   |
| 包管理     | pnpm + workspace + catalog | `10.18.1`        | workspace 软链 + 版本集中管理         |
| 任务编排   | turbo                      | `^2.10.5`        | 拓扑执行 + 本地构建缓存               |
| 语言       | TypeScript                 | `^5.9.3`         | 两级 `tsconfig` 继承                  |
| 库包构建   | tsup                       | `^8.5.1`         | ESM + CJS + d.ts 一站产出             |
| 应用构建   | Vite + @vitejs/plugin-vue  | vite `^8.1.5`    | 应用 dev/build/preview                |
| 类型检查   | tsc + vue-tsc              | vue-tsc `^3.3.7` | 应用额外校验 `.vue` 文件              |
| 测试       | Vitest + jsdom + @vue/test | vitest `^4.1.10` | 根统一跑,jsdom 兼容 Vue 组件          |
| 版本与发包 | @changesets/cli            | `^2.31.1`        | changeset 驱动版本/changelog/publish  |
| 代码规范   | ESLint(v10 扁平配置)       | `^10.7.0`        | typescript-eslint + eslint-plugin-vue |
| 格式化     | Prettier                   | `^3.9.5`         | 与 ESLint 通过 prettier config 解耦   |
| 提交规范   | commitizen + cz-git        | `^1.13.1`        | 中文交互式 prompt                     |
| 提交校验   | commitlint                 | `^21.2.1`        | conventional commits                  |
| Git 钩子   | husky                      | `^9.1.7`         | pre-commit + commit-msg               |
| 暂存区检查 | lint-staged                | `^17.0.8`        | 仅校验本次暂存文件                    |
| 拼写检查   | cspell                     | `^10.0.1`        | 全仓词法扫描                          |

---

## 二、环境要求

通过三处**强制**版本约束:

- `package.json` → `engines`:`node >=22.18.0`、`pnpm >=10.18.1`、`npm: "please-use-pnpm"`
- `package.json` → `packageManager: "pnpm@10.18.1"`
- `.npmrc` → `engine-strict=true` + `.nvmrc` 锁定 `22.18.0`

```bash
node -v                                  # 需 >= 22.18.0
corepack enable && corepack prepare pnpm@10.18.1 --activate   # 激活指定版本 pnpm
```

---

## 三、仓库结构

```
remote-monorepo/
├── apps/
│   ├── vue/                    # @remote/app-vue(private) Vite 应用
│   └── desktop/                # @remote/desktop(private) Electron 壳,渲染层复用 apps/vue
├── packages/
│   ├── utils/                  # @remote/utils      叶子工具包
│   ├── components/             # @remote/components 共享 UI 组件
│   ├── cli/                    # @remote/cli        CLI 工具(bin: remote-cli)
│   └── tsconfig.base.json      # 库包共享的严格 tsconfig
├── .changeset/                 # 版本与发包变更记录
│   ├── config.json
│   └── README.md
├── .husky/                     # Git 钩子(pre-commit / commit-msg)
├── apps/vue/tsconfig.json      # Vue3 + TS 特化 tsconfig
├── turbo.json                  # turbo 任务图
├── vitest.config.ts            # 根统一 Vitest 配置
├── pnpm-workspace.yaml         # workspace + catalog 集中版本
├── tsconfig.json               # 根基础 tsconfig
├── eslint.config.js            # ESLint 扁平配置
├── prettier.config.js          # Prettier 配置
├── commitlint.config.js
├── cspell.config.js
├── .lintstagedrc.json
├── .editorconfig
├── .nvmrc
├── .npmrc
├── .gitignore
└── package.json                # 根 workspace,聚合脚本入口
```

### 依赖方向(单向,禁止循环)

```
app-vue ──► components ──► utils
   └──────────────────────► utils
cli ──────────────────────► utils
desktop ──► app-vue(构建期依赖,复用其源码作为渲染层)
```

`utils` 是**叶子包**,不得依赖任何其它 workspace 包。内部依赖统一使用 `workspace:*` 协议,pnpm 软链本地源码而非从 registry 拉取。

| Package              | 目录                  | 可见性  | 角色            |
| -------------------- | --------------------- | ------- | --------------- |
| `@remote/app-vue`    | `apps/vue`            | private | Vue 3 应用      |
| `@remote/desktop`    | `apps/desktop`        | private | Electron 桌面壳 |
| `@remote/components` | `packages/components` | public  | 共享 UI 组件    |
| `@remote/cli`        | `packages/cli`        | public  | CLI 工具        |
| `@remote/utils`      | `packages/utils`      | public  | 叶子工具函数    |

---

## 四、快速开始

```bash
pnpm install                  # 装依赖并初始化 husky
pnpm -r list --depth -1       # 查看所有 workspace 包
pnpm --filter @remote/app-vue dev  # 启动 Web 端 dev server(5173)
pnpm build                    # turbo 拓扑构建所有包
pnpm typecheck                # turbo 类型检查(含 .vue)
pnpm test                     # vitest 跑全仓测试
pnpm lint / pnpm lint:fix     # ESLint 检查 / 自动修复
pnpm format                   # prettier 格式化
pnpm commit                   # cz-git 中文交互式提交
```

指定包执行:

```bash
pnpm --filter @remote/cli build       # 仅在某个包执行
pnpm --filter @remote/components dev  # 注意 dev 通常需要 cd 到该包或用 turbo filter

# 桌面壳(Electron):渲染层复用 apps/vue,dev server 用独立端口 5174
pnpm --filter @remote/desktop dev     # 起 Vite dev server(5174)+ 原生窗口,改 .vue 热更新
pnpm --filter @remote/desktop build   # out/* + electron-builder 出 release/win-unpacked(未签名)
pnpm --filter @remote/desktop build:bundle # 只构建 out/main、out/preload、out/renderer
pnpm --filter @remote/desktop package:dir  # 只跑 electron-builder --dir(需先 build:bundle)
pnpm --filter @remote/desktop start   # 用已构建产物直接启动 Electron
pnpm --filter @remote/desktop test    # 桌面壳主进程/preload 单测(node 环境)
```

> 首次运行桌面壳需联网下载 Electron 二进制(约 158MB),Electron 45 已无 postinstall,改为首次 `require('electron')` 时懒下载;内网环境需配置 `ELECTRON_MIRROR`。

> 根目录未定义 `dev` 脚本;`turbo run dev` 会把所有带 `dev` 脚本的包排进任务图(含 `@remote/desktop`),只起 Web 端请用 `pnpm --filter @remote/app-vue dev`。

> `dev` 类长进程任务已配置 `cache: false, persistent: true`,turbo 不会缓存也不会超时强杀。

---

## 五、turbo 任务编排

`turbo.json` 在仓库根,声明任务间的依赖关系与缓存策略。核心规则:

- `build` / `typecheck` / `test` 任务:`dependsOn: ["^build"]`,意味着**某个库包变更时,下游所有依赖它的包会重跑**
- `build` 任务:`outputs: ["dist/**"]`,产物纳入本地缓存(`.turbo/`,已 gitignore)
- `@remote/desktop#build` 声明 `dependsOn: ["^build"]` + `outputs: ["out/**", "release/**"]`:桌面壳的渲染层直接消费 `apps/vue` **源码**,必须先跑上游 `build` 才能把 `apps/vue` 的改动传导进缓存键,否则产物会陈旧
- `dev` 任务:`cache: false, persistent: true`,常驻进程不缓存
- `format` / `commit` / `lint:spelling` 等交互或不稳定输出:`cache: false`

实际效果:

| 场景                     | 首次 | 二次               |
| ------------------------ | ---- | ------------------ |
| `pnpm build`(无任何变更) | ~12s | ~30ms `FULL TURBO` |

`scripts` 里的 `build` / `typecheck` 走 `turbo run`,自动获得拓扑执行与缓存。

---

## 六、pnpm catalog 版本集中管理

`pnpm-workspace.yaml` 的 `catalog:` 块集中声明**会被多包共用的工具版本**:

```yaml
catalog:
  typescript: ^5.9.3
  tsup: ^8.5.1
  vite: ^8.1.5
  vue: ^3.5.40
  ...
```

各 `package.json` 用 `"catalog:"` 引用,不再写版本号:

```json
{
  "devDependencies": {
    "tsup": "catalog:",
    "typescript": "catalog:"
  }
}
```

升级时**改一处 `pnpm-workspace.yaml` 即可**,所有包同步。

---

## 七、TypeScript 配置体系

**两级继承**——根配置保持最通用,库包最严格,应用特化适配 Vue:

```
tsconfig.json (根:最基础的编译选项)
   │
   ├── packages/tsconfig.base.json (库包共享:严格管控)
   │      ├── packages/utils/tsconfig.json
   │      ├── packages/components/tsconfig.json
   │      └── packages/cli/tsconfig.json
   │
   └── apps/vue/tsconfig.json (应用:Vue3 + TS 特化)
```

| 层级                                   | 关键选项                                                                                                                                              | 用途                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **根** `tsconfig.json`                 | `target: ES2022`、`module: ESNext`、`moduleResolution: Bundler`、`isolatedModules`                                                                    | 全仓共享的最基本编译环境             |
| **库包** `packages/tsconfig.base.json` | 叠加 `strict`、`noUnusedLocals/Parameters`、`noImplicitReturns`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`declaration`、`sourceMap` | 对外发布的库需更严格的类型与产物声明 |
| **应用** `apps/vue/tsconfig.json`      | 直接继承根配置,追加 `lib: [ES2022, DOM, DOM.Iterable]`、`jsx: preserve`、`@/*` 路径别名、`noEmit`                                                     | 适配 Vue3 SFC + 浏览器,产物交给 Vite |

各 package 的 `tsconfig.json` 仅声明本包路径相关选项(`outDir` / `rootDir` / `include`),通过 `extends` 复用上层。

---

## 八、构建工具

### 库包:tsup

每个库包有 `tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
})
```

产物入口(`package.json`):

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "sideEffects": false
}
```

> ⚠️ `cli` 包额外有 `"bin": { "remote-cli": "./dist/index.js" }`,源码入口顶部带 `#!/usr/bin/env node` shebang,tsup 会保留。

### 应用:Vite

`apps/vue/vite.config.ts`:

```ts
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
```

`apps/vue/build` 脚本 = `vue-tsc --noEmit && vite build`,先类型检查再打包,确保产物类型干净。

---

## 九、测试

根统一跑,Vitest 配 `jsdom` 环境(`apps/vue` 组件测试需要 DOM):

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
  },
})
```

`pnpm test` 一次性跑全仓。`pnpm test:watch` 进入 watch 模式。

> 测试工具装在根,各包不需要声明——因为测试统一在根跑。

---

## 十、版本与发包(changesets)

`.changeset/` 目录管理 monorepo 的版本、changelog、发布流程。

### 流程

1. **写 changeset**(改完代码、提 PR 之前):

   ```bash
   pnpm changeset
   ```

   按提示选择:影响的包、版本类型(major / minor / patch)、变更描述。生成 `.changeset/<name>.md`,与代码改动一起提交。

2. **打版本号**(PR 合入后):

   ```bash
   pnpm release:version
   ```

   > 命名避开 `version`(pnpm 有内置 `version` 子命令,会劫持同名 script)。

   自动:
   - 根据 `.changeset/*.md` 给各包更新 `package.json` version
   - 各包根目录生成/更新 `CHANGELOG.md`
   - 删除已处理的 `.changeset/*.md`

3. **发布到 npm**:

   ```bash
   pnpm release:publish
   ```

   按依赖拓扑自动 `npm publish`。

### 版本类型

- `major`:破坏性变更
- `minor`:新增向后兼容功能
- `patch`:bug 修复

`@remote/app-vue` 是 private 应用,在 `config.json` 的 `ignore` 中排除,**不会被打版本也不会发包**。`updateInternalDependencies: "patch"` 表示上游依赖变更时下游自动 patch 升级。

---

## 十一、ESLint 配置策略

扁平配置(`eslint.config.js`,ESLint v9+ 风格),核心是**按包区分严格度**:

1. **全局忽略**:`dist`、`node_modules`。
2. **基础规则集**:`@eslint/js` recommended + `typescript-eslint` recommended + `eslint-plugin-vue` flat/recommended。
3. **库包(`packages/**`)**—— 最严格:
   - `no-explicit-any` / `explicit-module-boundary-types` / `no-non-null-assertion` / `consistent-type-imports` → `error`
   - `no-unused-vars` → `error`(`_` 前缀除外)
4. **应用(`apps/vue/**`)**—— 适度放宽:
   - `vue/multi-word-component-names` / `vue/component-api-style` / `vue/define-props-declaration` / `vue/require-default-prop` → `error`
   - `no-explicit-any` → `warn`(应用层允许但警告)
   - `apps/vue/src/App.vue` 单独豁免 `multi-word-component-names`(根组件惯例)
5. **Prettier 兜底**:`eslint-config-prettier` 放在最后,关闭与 Prettier 冲突的格式化类规则。

---

## 十二、Prettier 配置

`prettier.config.js` 统一全仓风格:

| 选项            | 值         | 含义                   |
| --------------- | ---------- | ---------------------- |
| `semi`          | `false`    | 不加分号               |
| `singleQuote`   | `true`     | 单引号                 |
| `printWidth`    | `100`      | 每行最大 100 字符      |
| `tabWidth`      | `2`        | 2 空格缩进             |
| `trailingComma` | `'all'`    | 多行尾随逗号           |
| `endOfLine`     | `'lf'`     | 统一 LF                |
| `arrowParens`   | `'always'` | 箭头函数参数始终带括号 |

按文件类型覆盖:`*.json` 保留双引号无尾随逗号;`*.md` `proseWrap: 'preserve'` 保留换行。

`.prettierignore` 排除 `node_modules`、`dist`、`pnpm-lock.yaml`。

---

## 十三、提交规范与 Git 钩子

### 约定式提交

`<type>(<scope>): <subject>`,commitlint 强制校验,类型 `feat / fix / docs / style / refactor / perf / test / chore / ...`。

### 交互式提交(推荐)

```bash
pnpm commit   # 启动 cz-git 中文 prompt
```

`commitlint.config.js` 预置别名,例如 `fd` → `docs: fix typos`。

### 钩子链路

| 钩子         | 文件                | 作用                                                |
| ------------ | ------------------- | --------------------------------------------------- |
| `pre-commit` | `.husky/pre-commit` | 执行 `lint-staged`,仅对暂存文件跑 ESLint + Prettier |
| `commit-msg` | `.husky/commit-msg` | 执行 `commitlint --edit`,校验提交信息格式           |

`lint-staged` 规则:代码文件先 ESLint 修复再 Prettier;配置/文档文件仅 Prettier。`prepare: husky` 在 `pnpm install` 后自动安装本地钩子。

---

## 十四、拼写检查

`pnpm lint:spelling` 通过 cspell 全仓扫描 `apps/**`、`packages/**`、根目录 `md/json/js/ts/vue` 等文件。

- 已预置词典(`monorepo`、`pnpm`、`eslint`、`prettier`、`vue`)与 `@cspell/dict-lorem-ipsum`
- 自动忽略 `node_modules`、`dist`、`build`、`pnpm-lock.yaml`、`package.json`、`tsconfig*.json`
- 第三方生成代码误报可在 `cspell.config.js` 的 `ignorePaths` / `words` 补充

---

## 十五、命令速查

| 命令                                  | 作用                                                     |
| ------------------------------------- | -------------------------------------------------------- |
| `pnpm install`                        | 装依赖并初始化 husky 钩子                                |
| `pnpm --filter @remote/app-vue dev`   | 启动 Web 端 dev server(5173)                             |
| `pnpm build`                          | turbo 拓扑构建所有包                                     |
| `pnpm typecheck`                      | turbo 类型检查                                           |
| `pnpm test` / `pnpm test:watch`       | vitest 全仓测试 / watch                                  |
| `pnpm lint` / `pnpm lint:fix`         | ESLint 检查 / 自动修复                                   |
| `pnpm format` / `pnpm format:check`   | Prettier 格式化 / 仅检查                                 |
| `pnpm lint:spelling`                  | cspell 拼写检查                                          |
| `pnpm commit`                         | cz-git 交互式提交                                        |
| `pnpm commit:lint`                    | 对已有提交信息跑 commitlint                              |
| `pnpm changeset`                      | 新建 changeset                                           |
| `pnpm release:version`                | 打版本号 + 生成 CHANGELOG                                |
| `pnpm release:publish`                | 拓扑发布到 npm                                           |
| `pnpm --filter <pkg> <cmd>`           | 在指定包执行                                             |
| `pnpm --filter @remote/desktop dev`   | 启动 Electron 桌面壳(渲染层复用 `apps/vue`,端口 5174)    |
| `pnpm --filter @remote/desktop build` | 构建 out/* 并打出 `release/win-unpacked`(win x64 未签名) |

> ⚠️ 不提供 `pnpm version` / `pnpm publish`——这些名被 pnpm 内置子命令占据,改用 `release:version` / `release:publish`。

---

## 十六、约定

1. **只用 pnpm**:`engines` + `.npmrc` 已阻断 npm/yarn。
2. **依赖单向**:`utils` 不依赖任何 workspace 包,新包沿 `app → components → utils` 方向声明。
3. **内部依赖用 `workspace:*`**:pnpm 软链本地源码。
4. **库包优先严格**:`packages/**` 公共 API 禁 `any`、需显式边界类型;应用层可逐步收敛。
5. **提交走 `pnpm commit`**:避免 `commit-msg` 钩子拦截。
6. **tsconfig 用继承**:新包通过 `extends` 复用上层配置,不复制粘贴。
7. **版本由 changeset 管**:不要手改 `package.json` 的 `version`。
8. **工具版本由 catalog 管**:不要在 package.json 里写版本号,统一用 `"catalog:"`。
