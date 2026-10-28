---
name: commit-monorepo-changes
description: Use when there are many pending changes in a monorepo (multiple packages, config files, docs, deps) and the user wants to commit them as a clean, reviewable set of conventional commits rather than one mega-commit. Triggers on "帮我提交这些变更", "把变更提交一下", "提交到 xxx(远端)", or any request to commit + push a large mixed set of edits.
---

# commit-monorepo-changes

按 conventional commits 语义,拆解一批混合变更为多个独立 commit 并推送。

## 适用场景

- 一次会话里改了很多东西(新文件、改 package.json、改 .ts/.vue、改 README、改 CI 等)
- 不想把全部变更挤成 1 个 commit(会让 git log 不可读、`pnpm release:version` 也无法按 commit 拆 changeset)
- 仓库遵循 conventional commits + commitlint(本仓库的 `commit-msg` 钩子会拦截格式错的提交)
- 仓库使用 lint-staged(commit 时会自动 lint+prettier 暂存区)

## 不适用场景

- 只有 1-2 个文件的小改动 → 直接 `git add` + `git commit -m` 即可
- 用户明确说"就一个 commit"

## 工作流(严格按顺序)

### 1. 摸底(必做)

```bash
git remote -v            # 确认远端 URL,推出目标平台(gitee / github / gitlab)
git status              # 看清变更全貌
```

**关键检查**:

- **危险文件**:如果看到 `.turbo/` / `node_modules/` / `dist/` / `*.log` / `.env` 等被 stage,**立刻 `git restore --staged <path>` 撤回**。这些通常应被 `.gitignore` 排除,如果漏配,在 commit 前补到 `.gitignore`。
- **嵌套子仓库**:看到 `?? apps/<some>/` 之类的整目录 untracked,**先 `ls apps/<some>/.git`**。有 `.git` 说明这是独立的子仓库(不是普通 package),不要 add 它(会被当 gitlink),而是在根 `.gitignore` 屏蔽整个目录,由子仓库自己管。
- **行尾警告(LF will be replaced by CRLF)**:Windows + LF Prettier 配置常见,不阻断,但要知道 commit 后远端会是 CRLF(若团队需要纯 LF,需先 `git config core.autocrlf false`)。

### 2. 设计 commit 边界

按"语义原子性"切分,常见拆法(参考本仓库):

| 类型        | 触发场景                            | 例                                                      |
| ----------- | ----------------------------------- | ------------------------------------------------------- |
| `build:`    | 构建/类型检查/test 工具链、产物配置 | `build: 引入构建、类型检查与测试工具链`                 |
| `feat:`     | 新增功能模块                        | `feat: 引入 turbo 任务编排与 pnpm catalog 集中管理版本` |
| `feat:`     | 新增工具/工作流                     | `feat: 引入 changesets 管理 monorepo 版本与发包`        |
| `docs:`     | 文档/注释/README                    | `docs: 更新 README.md 反映完整工具链`                   |
| `chore:`    | 不影响功能的杂项                    | `chore: 升级 typescript 至 5.9`                         |
| `fix:`      | bug 修复                            | `fix: 修复构建产物 main 入口错误`                       |
| `refactor:` | 重构(无新功能)                      | `refactor: 重构 utils 包目录结构`                       |

**每条 commit 的文件清单要可独立 review**。一个 commit 内如果同时改 "业务逻辑 + 工具配置 + 文档",说明切得太粗。

### 3. 拆分 staging(逐个 commit 准备)

```bash
# 重置暂存区到 HEAD,从干净状态开始按 commit 边界 add
git reset HEAD              # 全部撤回 working tree

# 第一个 commit
git add <files-of-commit-1>
git status --short | grep -E "^[AMDR] "   # 核对 staging

# commit(中文 message,commitlint 不拦截正文语言)
git commit -m "..."
```

**经验**:`git commit -m` 用多行字符串(heredoc 或 `-m "..." -m "..."` 或 `printf` 内嵌换行)写详细正文,比单行 `m "type: 主题"` 信息量大很多。

### 4. 每个 commit 前核对 staging

```bash
git diff --stat --cached     # 看本次 commit 会改多少行、哪些文件
```

**核对清单**:

- [ ] 没有误入危险文件(`.turbo/`, `dist/`, `node_modules/`)
- [ ] 没有漏文件(应该一起的概念性文件都 stage 了)
- [ ] 没有多文件(超出本 commit 语义的改了)

### 5. commit 后核对

```bash
git status                   # working tree 应剩部分变更,已 commit 部分消失
git log --oneline -n <count>  # 看 commit 顺序、message 是否清晰
```

### 6. 全部 commit 完成,推送

```bash
git status                   # 必须 working tree clean
git log --oneline origin/master..HEAD   # 看本批有几条 commit
git push origin <branch>     # 默认 master
```

### 7. 多仓库工作流(可选：存在嵌套子仓库时)

当前仓库默认只有父仓库。如果任务涉及 `apps/*` 或 `packages/*` 下自带 `.git` 的嵌套仓库，按本节处理；否则跳过。

#### 7.1 摸底时识别所有仓库

```bash
# 在父仓库根目录
git status                              # 父仓库的变更
ls -d apps/*/.git packages/*/.git 2>/dev/null   # 找出所有嵌套子仓库的 .git
# 然后对每个子仓库,逐个 cd 进去看状态:
for d in apps/*/ packages/*/; do
  [ -d "$d/.git" ] && echo "=== $d ===" && git -C "$d" status --short
done
```

#### 7.2 文件归属规则(自动分流)

按"文件的最近 git 根目录"分流:

- 父仓库只提交自己目录下、不属于嵌套仓库的文件。
- 嵌套仓库的文件由它自己的 git 管理。
- 各仓库远端以 `git remote -v` 为准，不要复用旧 URL 或旧分支名。

#### 7.3 串行 commit(按依赖顺序:子 → 父)

```bash
# 第一步:先提交嵌套子仓库
git -C apps/<sub-app> status
git -C apps/<sub-app> add <files>
git -C apps/<sub-app> commit -m "<type>: <subject>"
git -C apps/<sub-app> push origin <branch>

# 第二步:再提交父仓库
git add <files>
git commit -m "<type>: <subject>"
git push origin <branch>
```

**为什么先子后父**:子仓库的 `package.json` 可能引用父仓库 catalog 里的版本;先推子仓库再推父仓库,远端历史更连贯。

#### 7.4 失败回滚

如果子仓库 push 失败:

1. **不要回滚父仓库已推的 commit**(父子仓库是独立历史,父仓库的 commit 不依赖子仓库的状态)
2. 检查子仓库远端认证、branch 名冲突
3. 修好后单独重 push 子仓库
4. 父仓库不用动

#### 7.5 不要用 submodule 伪装嵌套仓库

如果用户明确要求两个仓库独立识别，**不要尝试用 `git submodule`** 把子仓库挂回父仓库——会丢失子仓库独立的 commit 历史与远端 URL 配置。

## commit message 模板(中文)

```text
<type>: <一句话主题,不超 50 字>

<正文段落 1: 改了哪几个维度>
- <维度 1>
- <维度 2>
- <维度 3>

<正文段落 2: 关键动机/取舍(可选)>
- <为什么这么做>
- <踩过的坑,以及规避方法>

<正文段落 3: 副作用/兼容(可选)>
- <依赖升级影响>
- <行为变更>
```

**示例**(本仓库实际用过):

```text
feat: 引入 turbo 任务编排与 pnpm catalog 集中管理版本

turbo 负责拓扑执行 + 本地构建缓存,二次构建全缓存命中仅 ~30ms
- 新增 turbo.json 声明任务图:build/typecheck/test dependsOn ^build,
  dev 任务 cache:false + persistent,format/commit 等交互任务不缓存
- 根 scripts 的 build/typecheck 切换为 turbo run

pnpm catalog 集中管理多包共用工具版本,后续升级改一处即可
- pnpm-workspace.yaml 新增 catalog 块,声明 typescript/tsup/vue/vite/
  @vitejs/plugin-vue/vue-tsc/vitest/@vue/test-utils/jsdom 共 9 个工具
- 各 package.json 改用 catalog: 引用,不再重复写版本号
```

## 踩坑提醒

1. **pnpm/npm 内置命令会劫持同名 script**:`pnpm version` 调的是 npm version,不是你的 `version` script。如果必须用同名,加前缀(如本仓库的 `release:version`)。
2. **`.turbo/` 即使在 `.gitignore` 也可能被 stage**:先用 `git restore --staged .turbo/` 撤回。
3. **lint-staged 会自动 add 它修改的文件**:commit 完可能发现多了几个文件(被 prettier 改的),正常。
4. **大文件 / 二进制文件**:如果不该进仓库(如 `*.tar.zst`),必须 `.gitignore` + `git rm --cached`。
5. **changeset 工作流**:`.changeset/*.md`(具体的 changeset 内容)不提交(因为 `release:version` 会自动删);但 `.changeset/config.json` 和 `.changeset/README.md` **要提交**(配置/文档)。
6. **commit message 长度限制**:commitlint 有 header-max-length(默认 100)限制,正文不限,但 type 必须小写、必填。
7. **subject-case 必须小写**:本仓库 commitlint 配置了 `subject-case`,subject 中**禁止 sentence-case / start-case / pascal-case / upper-case**。`docs: CLAUDE.md ...`、`chore(eslint): ...` 都会被拒;`docs: claude.md ...` 才过。**subject 里出现的文件/工具名(CLAUDE.md、ESLint、Vue)也得小写或避开**(实在避不开就用 `claude.md`、`eslint`、`vue` 这样的全小写)。正文(body)语言不限制。
8. **body-max-line-length 100**:正文每行不能超 100 字符。中文字符在 UTF-8 下占 3 字节但 commitlint 按字符数算,中文 1 字符算 1,所以一行中文约可写 ~33 字(留余量就按 30 字换行)。**写正文时心里默念"超 30 个中文字就换行"**。
9. **嵌套子仓库(embedded git repo)**:如果某个 `apps/*` 或 `packages/*` 子目录自带 `.git`，它不是普通 workspace package。父仓库 `git status` 会显示整个目录未追踪，`git add` 时 git 会把它当 gitlink 提示 `adding embedded git repository`——这种状态下文件不会被追踪。**处理方式**:确认它确实独立后，在根 `.gitignore` 屏蔽该目录，由子仓库自己提交到自己的远端；不要把它 add 进父仓库。
10. **`git status --short` vs `git diff --stat` 可能不一致**:`git status --short` 显示 6 个文件 modified,但 `git diff --stat` 可能只显示 3 个真实改动(其它 3 个的变更被某种机制 revert 了或本来就是空 diff)。**提交前一定要用 `git diff --cached --stat` 确认 staging 区到底是什么**,不要信 `--short` 的初始数字。
11. **`core.autocrlf=true` 会让 git status 报一堆假阳性**:`git status` 显示 25 个文件 modified,但 `git diff --stat` 只显示 2 个真改动,其余是 autocrlf 把 LF 转 CRLF 的"将 LF 替换为 CRLF"警告。_*多仓库工作流下,父仓库 status 里看到所有 packages/* 与 apps/_ 都 modified 但 diff 空,基本就是这个原因**,提交时只看 diff 为准,不要被 status 的 modify 数量吓到。永久解决:`git config core.autocrlf false`(若团队能接受 LF 提交)。

## 完成检查清单

- [ ] `git status` 干净(全部 commit)
- [ ] `git log --oneline origin/master..HEAD` 列出本批 commit
- [ ] 每条 commit message 格式:`<type>(<scope>): <subject>` 或 `<type>: <subject>`
- [ ] 每条 commit 文件清单语义内聚
- [ ] `git push origin <branch>` 成功
- [ ] 远端 git log 显示本批 commit
