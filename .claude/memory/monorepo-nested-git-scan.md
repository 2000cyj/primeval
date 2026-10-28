---
name: monorepo-nested-git-scan
description: 扫描 monorepo git 状态时必须下钻到每个 workspace 子包检查嵌套 .git，不能只信根目录 status
metadata:
  type: feedback
---

在 `remote-monorepo` 扫描未提交变更时，根目录 `git status` 干净 ≠ 整体干净。
原因：`apps/remote-control-vue3/.git` 是嵌套仓库，根 `.git` 把它当普通目录不跟踪。

**Why:** 本项目混用了 workspace 包和嵌套 git 仓库（至少 `apps/remote-control-vue3` 是独立的），靠根 `git status` 会漏掉子仓库里的所有变更。

**How to apply:** 在 monorepo 根跑 `git status` 之前，先遍历 `apps/*` 和 `packages/*` 用 `ls -la` 检查每个子包是否含 `.git/`（目录，不是文件）；有的就 `cd` 进去单独跑 `git status`。批量检查可写脚本一次扫完所有 workspace 成员的 `.git/`。
