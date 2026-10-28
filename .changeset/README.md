# Changesets

本目录用于管理 monorepo 的版本与发布。

## 使用流程

1. **写 changeset**(改完代码、提 PR 之前):

   ```bash
   pnpm changeset
   ```

   按提示选择:影响的包、版本类型(major / minor / patch)、变更描述。

   这会在 `.changeset/` 下生成一个 `*.md` 文件,把它和代码改动一起提交。

2. **打版本号**(PR 合入后):

   ```bash
   pnpm release:version
   ```

   > 注意:这里用 `release:version` 而非 `version`,因为 pnpm 内置了 `version` 子命令会劫持同名 npm script。

   自动:
   - 根据 `.changeset/*.md` 给各包更新 `package.json` version
   - 在每个包根目录生成/更新 `CHANGELOG.md`
   - 删除已处理的 `.changeset/*.md`

3. **发布到 npm**:

   ```bash
   pnpm release:publish
   ```

   按依赖拓扑自动 `npm publish`。

## 约定

- 一个 PR / 一次发版可以包含多个 changeset(每改一个独立语义就写一个)
- 版本类型参考 semver:
  - `major`:破坏性变更
  - `minor`:新增向后兼容的功能
  - `patch`:bug 修复
- 当前三个可发版包(`@remote/utils`、`@remote/components`、`@remote/cli`)独立管理版本;`@remote/app-vue` 是 private 应用,不发版
