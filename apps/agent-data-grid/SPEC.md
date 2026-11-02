# DataGrip 对标实现契约（React + 移植 OpenIDEA UI 套件）—— `apps/agent-data-grid`

> 目标：对标 **JetBrains DataGrip**（浅色 IntelliJ New UI 观感）的桌面端。
> **只做前端样式与静态交互对标，功能不实现**（不连数据库、不执行 SQL）。
>
> 技术栈（已就位，勿改动）：
>
> - **React 19 + TypeScript**，`@vitejs/plugin-react`，alias `@/*` → `src/renderer/src/*`
> - **UI 套件：移植自 https://github.com/l0ng-ai/openidea 的 `src/ui`（Apache-2.0）**
>   位于 `src/renderer/src/ui/`：Button / Input / Select / Checkbox / Menu / Popup / Tooltip /
>   Tabs / Tree / List / Kbd / Dialog / Splitter / BarButton / FloatingToolbar / Feedback /
>   HighlightedText / icons（IntelliJ expui 图标集）
> - **主题**：`src/renderer/src/styles/tokens.css`（OpenIDEA 的 Islands 主题）+ `styles/global.css`
>   （已内含 `--bg-*` `--fg-*` `--font-ui` 等令牌，并已 `@import` 本地字体 Inter / JetBrains Mono）
> - 状态管理：**zustand**（已装）；布局分栏可用 `react-resizable-panels`（已装）
> - **禁止**引入 Element Plus / Vue / 任何新依赖；禁止写新的全局 CSS 主题。

## 0. 使用移植套件的关键约束

1. **组件 API 以源码为准**：动手前先读 `src/renderer/src/ui/<组件>.tsx` 的 props 定义，不要猜。
   常用：
   - `Icon`：`import { Icon } from '@/ui'` → `<Icon name="database" size={16} />`
     图标名见 `src/renderer/src/ui/icons.tsx` 的 `BaseName`（IntelliJ expui 图标名，如
     `database` `table` `folder` `run` `execute` `search` `settings` `console` `terminal`
     `dataSource` `refresh` `plus` `close` `chevronDown` 等）。找不到合适的就用 `icons.tsx` 里真实存在的名字。
   - `Tree`：`roots / getKey / getLabel / getChildren / isExpandable / getIcon / getDetail /
expanded / selected / onSelectionChange / renderNode`（详见 `ui/Tree.tsx` 的 `TreeProps`）。
   - `Button`：`variant="primary|secondary|ghost"`、`size="normal|small"`、原生 button 属性。
   - `Menu` / `Popup` / `Tooltip` / `Tabs` / `Input` / `Select` / `Checkbox` / `List` / `Kbd`：
     同样先读源码 props。
2. **样式只用 CSS Modules**（`*.module.css`）或内联 style，**颜色一律用 `var(--fg-*)` /
   `var(--bg-*)` / `var(--border*)` 等主题变量**，禁止写死色值；禁止新增全局 CSS 文件
   （`styles/layout.css` 由父 agent 独占）。
3. 组件目录：`src/renderer/src/components/{shell,database,console,results}/`。
4. 图标一律用套件的 `<Icon />`，不要自己画 svg。
5. 主题：本应用固定浅色（`<html data-theme="light">`，已在 `index.html` 配好）。
   需要自定义颜色时用 `var(--fg-*)`/`var(--bg-*)`；不要写 `:root[data-theme="dark"]` 分支。
6. 禁止 `any`；禁止 `React.FC`；函数组件 + hooks 写法。

## 1. 整体骨架（`App.tsx` 已按此接线，勿改）

```
.adg-shell (flex column, 100vh)
├── MenuBar                 菜单栏
├── AppToolbar              上下文工具栏
├── .adg-body (flex row, flex:1)
│   ├── ToolWindowBar       工具窗口条(竖排图标)
│   ├── DatabaseExplorer    左栏(Database 树 + Services 面板)
│   └── .adg-workspace (flex column, flex:1)
│       ├── .adg-console (flex row, flex:1)
│       │   ├── .adg-console-main (flex column, flex:1)
│       │   │   ├── ConsoleTabs
│       │   │   ├── ConsoleToolbar
│       │   │   └── SqlConsole
│       │   └── ObjectInfoPanel
│       └── .adg-results
│           └── ResultsPanel
└── StatusBar               状态栏
```

布局类名由父 agent 在 `styles/layout.css` 提供（`.adg-shell` `.adg-body` `.adg-workspace`
`.adg-console` `.adg-console-main` `.adg-results` 等），**只写自己组件内部的样式**。

## 2. MenuBar

- 一行菜单：`File` `Edit` `View` `Navigate` `Query` `Tools` `Window` `Help`。
- 用套件的 `Menu`/`Popup`（或 `Button variant="ghost"`）实现下拉，每个菜单给 3~5 个**假条目**
  （File：New Query / Data Sources and Drivers / Close Project；Query：Run / Explain Plan / Stop）。
- 13px，文字用 `var(--fg)`，hover 用套件默认态即可。

## 3. AppToolbar

- 左侧：数据源选择（`Select` 或 `Button` + `Popup`），显示
  `PostgreSQL - Acme Production @ localhost:5432`（3 个数据源可切换，只改本地 state）。
  后面跟 4~6 个圆形图标按钮（`Icon` + `Tooltip`）：新建查询 / 刷新 / 执行 / 停止 / 收藏。
- 右侧：`Checkbox`「自动提交」+ `Select`「限制 100 行」（100/500/1000/无限制）+ `Button`「设置」。
- 高度 36px，左右内边距 8px。

## 4. ToolWindowBar

- 竖排 5 个图标按钮（`Icon` + `Tooltip`）：项目 / 结构 / **数据库（选中）** / 服务 / 终端（吸底）。
- 选中项：图标色用 `var(--fg-accent)`（若该变量不存在，用 `var(--accent, #3574f0)` 这类 fallback 写法），
  背景用 `--bg-elev` 一类的悬浮色；未选中 `var(--fg-muted)`。
- 宽 40px，右侧 1px `var(--border)` 分隔线。

## 5. DatabaseExplorer（左栏）

- 上半 **Database 面板**：
  - 工具窗口头：标题 `Database` + 右侧 3 个图标按钮。
  - 一行小工具条：`Input`（placeholder 搜索对象）+ 一个图标按钮。
  - **用套件的 `Tree`** 渲染数据源树，数据来自 `src/renderer/src/data/dataSources.ts`：
    ```
    Acme Production
      customer_analytics
        Schemas
          public
            Tables
              users ← 默认选中
              accounts / events / invoices / plans
            Views
            Functions
        Roles
        Extensions
    Staging Warehouse
    Local Sandbox
    ```
    用 `getIcon` 返回 expui 图标名（数据库→`database`，库→`dataSource`，目录→`folder`，
    表→`table`，视图→`table` 等，按 `icons.tsx` 里真实存在的名字取）。
    用 `getDetail` 显示右侧计数（Schemas 3 / Tables 12 / Views 4 / Functions 7）。
- 下半 **Services 面板**（高约 180px）：标题 `Services` + `Tree`（小号）显示
  `查询执行 → Run 'customer_growth.sql'`（绿点）、`数据库连接 → Acme Production`（灰点）。
  状态点用一个小圆 div（颜色 `var(--fg-success, #359548)` / `var(--fg-muted)`）。

## 6. ConsoleTabs

- 扁平标签：`Query 1`（选中：白底 + 顶部 2px 蓝色下边框）、`customer_growth.sql`（未选中 + 关闭图标）、
  末尾 `+` 按钮。
- 用套件 `Tabs` 组件或自绘 div；文字 13px。

## 7. ConsoleToolbar

- 绿色「执行」按钮（`Button`，绿色用 `var(--fg-success, #359548)`）+「停止」+ 分隔线 +
  `Checkbox`「自动提交」+ `Select`「限制 100 行」+ `Button`「解释计划」。

## 8. SqlConsole

- 白底（`var(--bg-editor, #fff)`）；左侧 44px 行号槽（`var(--bg-panel)` 底、行号 `var(--fg-muted)`），
  右侧编辑区等宽字体 `var(--font-mono, 'JetBrains Mono')` 13px / 行高 1.6。
- 用原生 `<textarea>`（套件 Input 组件是单行，编辑器需要多行 → 用 textarea + CSS 复位）。
- 行号与文本行数同步，两侧滚动同步。
- 默认 SQL：
  ```sql
  SELECT
      u.id,
      u.full_name,
      u.email,
      p.name AS plan,
      u.status,
      u.created_at
  FROM users u
      LEFT JOIN plans p ON p.id = u.plan_id
  WHERE u.created_at >= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY u.created_at DESC
  LIMIT 100;
  ```
- 受控组件：`value` + `onChange`。

## 9. ObjectInfoPanel（右栏）

- 工具窗口头「对象信息」+ 对象摘要（32×32 圆角方块 + 图标 + 标题 `users` + 副标题「表」）。
- `Tabs`：`列` / `约束` / `索引`。
  - 列：`id int4` / `full_name varchar` / `email varchar` / `plan_id int4` / `status varchar` /
    `created_at timestamptz`（两列：名称 / 类型）。
  - 约束：主键 / 外键 / 唯一 列表。
  - 索引：`users_pkey`（主键）/ `users_email_idx`（唯一）/ `users_created_at_idx`。

## 10. ResultsPanel

- 顶部工具窗口头一行页签：`表格` `树` `输出` `解释计划` `消息`（选中项底部 2px 蓝色下边框），
  右侧「已获取 8 行，用时 42 毫秒」。
- 下方结果表格：列 `#` `id` `full_name` `email` `plan` `status` `created_at`；
  行高 24px、12px 文字、表头 `var(--bg-panel)` 底、细边框 `var(--border)`。
  `status` 列为「6px 彩色圆点 + 文字」：Active 绿 / Pending 橙 / Inactive 灰。
- 数据 8 行（与 `data/resultRows.ts` 一致）：

  | #   | id    | full_name     | email                 | plan       | status   | created_at          |
  | --- | ----- | ------------- | --------------------- | ---------- | -------- | ------------------- |
  | 1   | 10042 | Liam Chen     | liam.chen@acme.io     | Pro        | Active   | 2025-04-18 09:32:11 |
  | 2   | 10041 | Mia Rodriguez | mia.r@northstar.co    | Team       | Active   | 2025-04-18 09:28:04 |
  | 3   | 10040 | Noah Williams | noah.w@pixelbase.dev  | Free       | Pending  | 2025-04-18 09:14:52 |
  | 4   | 10039 | Emma Thompson | emma@arcstudio.design | Pro        | Active   | 2025-04-18 08:57:36 |
  | 5   | 10038 | Oliver Smith  | oliver@helios.ai      | Enterprise | Active   | 2025-04-18 08:42:19 |
  | 6   | 10037 | Ava Martin    | ava.martin@luma.app   | Team       | Inactive | 2025-04-18 08:20:03 |
  | 7   | 10036 | Elijah Davis  | elijah@vertexlabs.io  | Free       | Active   | 2025-04-18 08:01:47 |
  | 8   | 10035 | Sophia Wilson | sophia@papertrail.co  | Pro        | Active   | 2025-04-17 23:46:28 |

- 表格自己实现（HTML table + CSS）或用套件 `List`；不要引入表格库。

## 11. StatusBar

- 一行：左 `Acme Production @ localhost:5432` · `PostgreSQL 16.2` · `无事务`；
  右 `就绪`(绿点) · `UTF-8` · `LF` · `SQL`。组间 1px 分隔线，12px `var(--fg-muted)`。

## 12. 组件 API 契约（`App.tsx` 已按此接线，**不要改签名**）

| 组件                            | props                                                                                                                    | 说明 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- |
| `shell/MenuBar.tsx`             | 无                                                                                                                       |      |
| `shell/AppToolbar.tsx`          | `dataSource: string`                                                                                                     |      |
| `shell/ToolWindowBar.tsx`       | `active: string`、`onActiveChange: (v: string) => void`                                                                  |      |
| `shell/StatusBar.tsx`           | `connection`、`serverVersion`、`transaction`（string）                                                                   |      |
| `database/DatabaseExplorer.tsx` | 无                                                                                                                       |      |
| `console/ConsoleTabs.tsx`       | `active: string`、`onActiveChange`                                                                                       |      |
| `console/ConsoleToolbar.tsx`    | `autoCommit: boolean`、`onAutoCommitChange: (v: boolean) => void`、`limit: number`、`onLimitChange: (v: number) => void` |      |
| `console/SqlConsole.tsx`        | `value: string`、`onChange: (v: string) => void`                                                                         |      |
| `console/ObjectInfoPanel.tsx`   | `objectName: string`                                                                                                     |      |
| `results/ResultsPanel.tsx`      | 无                                                                                                                       |      |

## 13. 文件归属（**只准写自己这一列的文件**）

| Worker   | 允许创建/修改的文件                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| A 外围   | `components/shell/MenuBar.tsx`、`shell/AppToolbar.tsx`、`shell/ToolWindowBar.tsx`、`shell/StatusBar.tsx`                    |
| B 左栏   | `components/database/DatabaseExplorer.tsx`、`data/dataSources.ts`                                                           |
| C 控制台 | `components/console/ConsoleTabs.tsx`、`console/ConsoleToolbar.tsx`、`console/SqlConsole.tsx`、`console/ObjectInfoPanel.tsx` |
| D 结果区 | `components/results/ResultsPanel.tsx`、`data/resultRows.ts`                                                                 |

**共享只读**（谁都不许改）：`App.tsx`、`styles/**`、`ui/**`、`platform/**`、`main.tsx`、
`package.json`、`src/main|preload|shared`。

## 14. 验收标准

1. `tsc --noEmit -p tsconfig.renderer.json` 中**你自己的文件**零错误。
2. `eslint` 你的文件：0 error；`prettier --check` 通过。
3. 视觉：DataGrip 观感（浅色、13px、蓝色强调、细边框、行高 24px、工具窗口条、Services 面板、
   Object Info 三页签、结果五页签）。
4. 只用移植套件 + React + zustand；不新增依赖；不写死色值；不写全局 CSS。
