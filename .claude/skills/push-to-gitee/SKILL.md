---
name: push-to-gitee
description: Use when the user wants to push commits to a Gitee remote (https://gitee.com/...). Triggers on "推到 gitee", "提交到 gitee", "push 到码云". Provides the Chinese commit message template and Gitee-specific gotchas. Pairs with commit-monorepo-changes for multi-commit batches; can also be used standalone for a single commit + push.
---

# push-to-gitee

把本地 commit 推送到 Gitee 远端,中文 commit message 模板 + Gitee 特有的注意事项。

## 适用场景

- 远端是 `https://gitee.com/...`
- 用户希望用中文写 commit message
- 单 commit 或多 commit 推送均可

## 推送流程

### 1. 确认远端

```bash
git remote -v
```

期望输出含 `https://gitee.com/<owner>/<repo>.git`。如果不是 Gitee,改用其他平台(github / gitlab)的对应 skill,不要硬上。

### 2. 确认分支

```bash
git branch --show-current    # 默认 master
git status                   # 应 working tree clean
```

### 3. 推送

```bash
git push origin <branch>
```

> ⚠️ 仅当第 1 步确认远端确实是 Gitee 时使用本 skill。HTTPS 和 SSH(`git@gitee.com:...`)两种远端都支持。

### 4. 验证

```bash
git log --oneline origin/<branch> -n 5
```

或在浏览器打开 `https://gitee.com/<owner>/<repo>/commits/<branch>` 看 commit 历史。

## 中文 commit message 模板

Gitee 与 GitHub 都对 commit message 内容语言无限制,**只校验格式**。中文 message 通过 commitlint 校验的关键:

| 要素       | 要求                        | 错误示例                     |
| ---------- | --------------------------- | ---------------------------- |
| type       | 小写、必填                  | `Build:` ❌ `build:` ✅      |
| 冒号后空格 | `<type>: <subject>`         | `feat:xxx` ❌ `feat: xxx` ✅ |
| 主题长度   | ≤ 100 字符(commitlint 默认) | 超长 ❌                      |
| scope 可选 | `(<scope>)`                 | `feat(utils): add foo` ✅    |

**推荐的多行 message 写法**(Bash):

```bash
git commit -m "feat: 引入 turbo 任务编排与 pnpm catalog 集中管理版本

turbo 负责拓扑执行 + 本地构建缓存,二次构建全缓存命中仅 ~30ms
- 新增 turbo.json 声明任务图:build/typecheck/test dependsOn ^build,
  dev 任务 cache:false + persistent,format/commit 等交互任务不缓存
- 根 scripts 的 build/typecheck 切换为 turbo run

pnpm catalog 集中管理多包共用工具版本,后续升级改一处即可
- pnpm-workspace.yaml 新增 catalog 块,声明 9 个工具
- 各 package.json 改用 catalog: 引用"
```

> 用 `$'...\n...'` 或 heredoc 可以写真正的多行 message。本仓库的 commit-msg 钩子会跑 commitlint 校验。

## Gitee 特有注意事项

1. **Gitee 邮箱隐私**:Gitee 默认对邮箱做隐私保护(显示为 `user@local`),不影响推送。
2. **HTTPS 推送免 token(部分场景)**:Gitee 在某些浏览器登录态下,git push 走 HTTPS 可能要密码。遇到 `Support for password authentication was removed` 提示,需用**私人令牌**(Gitee 头像 → 设置 → 私人令牌)。
3. **Gitee Go / Gitee Pages**:本 skill 不涉及这些,如需部署 Gitee Pages,用对应 skill。
4. **PR 习惯**:Gitee 用"Pull Request"而非 GitHub 的"Pull Request",术语一致;评审评论风格略不同,但与 commit 推送无关。

## 完成检查清单

- [ ] `git status` clean
- [ ] `git log --oneline origin/<branch>..HEAD` 列出本批 commit
- [ ] `git push origin <branch>` 成功(无错误码)
- [ ] 远端页面验证 commit 已出现

## 跨多个仓库串行 push(可选)

如果工作区里有多个 git 仓库(父 monorepo + 自带 `.git` 的子目录)，每个仓库的远端以 `git remote -v` 为准，逐个仓库串行推送，互不依赖。

### 适用结构

```text
workspace/                    # 父仓库
├── .git/                     # 远端以 git remote -v 为准
├── apps/
│   └── <sub-app>/.git/       # 可选：独立子仓库
└── packages/
    └── ...
```

### 推送顺序(子 → 父)

```bash
# 1. 找出所有仓库根目录
ls -d apps/*/.git packages/*/.git .git 2>/dev/null

# 2. 先推子仓库；只处理确实带 .git 的目录
for repo in apps/* packages/*; do
  [ -d "$repo/.git" ] || continue
  echo "=== pushing $repo ==="
  git -C "$repo" status
  git -C "$repo" log --oneline "origin/$(git -C "$repo" branch --show-current)..HEAD"
  git -C "$repo" push origin "$(git -C "$repo" branch --show-current)"
done

# 3. 最后推父仓库
git push origin "$(git branch --show-current)"
```

### 推送顺序原则

- **叶子仓库先推**(没有依赖其它子仓库的)
- **被依赖最多的子仓库先推**(被父仓库 catalog 引用的先推)
- **父仓库最后推**(父仓库 commit 可能引用子仓库的声明/版本)

如果不确定顺序,**问问用户**:「子仓库先还是父仓库先?」,别瞎猜。

### 各仓库独立检查清单

每个仓库 push 后独立核对:

- [ ] 该仓库 `git status` clean
- [ ] 该仓库 `git log --oneline origin/<branch> -n <commit-count>` 显示新 commit
- [ ] 该仓库远端页面看到 commit
- [ ] 失败不阻塞其它仓库(单独 retry 即可,父子仓库历史互不依赖)

### 常见误操作

- ❌ 在父仓库 `cd apps/<sub> && git push` 后忘记 `cd ..` ——bash 状态可能延续(用 `( cd ... )` 子 shell 隔离)
- ❌ 子仓库 push 失败后回滚父仓库已推 commit ——父子仓库历史独立,父仓库 commit 不依赖子仓库状态
- ❌ 跨仓库合并 commit(如把子仓库改动塞进父仓库 commit)——会污染父子仓库的 commit 历史,违反多仓库独立性
