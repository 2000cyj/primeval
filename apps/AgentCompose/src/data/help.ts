/**
 * 帮助中心的内容 —— 命令行操作 + 界面说明。
 *
 * 数据驱动而不是写死在模板里：搜索、分类、折叠都靠它。
 * 界面上说明的每个功能都对应真实实现，改代码时顺手改这里。
 */

export type HelpCommand = {
  /** 命令（不含 `agentspace`） */
  cmd: string
  /** 做什么 */
  desc: string
  /** 用法例子 */
  example?: string
}

export type HelpGroup = {
  /** 分组名 */
  title: string
  /** 一句话说明这个分组 */
  hint?: string
  /** 里面的命令 */
  commands: HelpCommand[]
}

export type HelpPage = {
  /** 页面名（跟侧边栏一致） */
  title: string
  /** 这个页面干什么 */
  desc: string
  /** 页面上能做的事 */
  points: string[]
}

export type HelpTopic = {
  key: string
  label: string
  kind: 'command' | 'page' | 'version'
}

// ── 命令行 ────────────────────────────────────────────────────

export const commandGroups: HelpGroup[] = [
  {
    title: '起一个智能体',
    hint: '把智能体装进当前目录，再拉起它',
    commands: [
      {
        cmd: 'run <名称>',
        desc: '准备目录并启动智能体（当前只支持 Pi）',
        example: 'agentspace run 知识助手',
      },
      {
        cmd: 'install <名称>',
        desc: '只把智能体装进当前目录，不启动。目录里已有配置会问你要不要覆盖',
        example: 'agentspace install 知识助手',
      },
      {
        cmd: 'update <名称>',
        desc: '更新当前目录里的智能体，不启动。装的是另一个智能体会问你要不要替换',
        example: 'agentspace update 知识助手',
      },
    ],
  },
  {
    title: '智能体',
    hint: '我们创建的智能体，跑在 Pi 上',
    commands: [
      { cmd: 'agent list', desc: '列出全部智能体' },
      { cmd: 'agent get <名称>', desc: '看一个智能体的详情' },
      { cmd: 'agent create <名称>', desc: '新建一个智能体' },
      { cmd: 'agent update <名称>', desc: '改一个智能体' },
      { cmd: 'agent delete <名称>', desc: '删一个智能体' },
      { cmd: 'agent copy <名称>', desc: '复制一个智能体' },
      { cmd: 'agent import <目录>', desc: '从 pi 项目一键导入：skill、mcp、指令、绑定关系' },
      { cmd: 'agent skills list|add|remove', desc: '管理绑定的 Skill' },
      { cmd: 'agent mcp list|add|remove', desc: '管理绑定的 MCP' },
      {
        cmd: 'agent wiki list|add|remove',
        desc: '管理绑定的 Wiki 页面（绑入口页面，子树连带继承）',
        example: 'agentspace agent wiki add 知识助手 部署手册',
      },
    ],
  },
  {
    title: 'Skill 仓库',
    commands: [
      { cmd: 'skill list', desc: '列出全部 skill' },
      { cmd: 'skill get <名称>', desc: '看详情（含文件清单与正文）' },
      { cmd: 'skill create <名称>', desc: '手动创建一个 skill' },
      { cmd: 'skill update <名称>', desc: '改名字、描述或正文' },
      { cmd: 'skill delete <名称>', desc: '删一个 skill' },
      { cmd: 'skill duplicate <名称>', desc: '复制一个 skill' },
      { cmd: 'skill enable|disable <名称>', desc: '启用 / 停用' },
      { cmd: 'skill refresh <名称>', desc: '从来源刷新（本地路径或网址）' },
      { cmd: 'skill import <路径|网址>', desc: '从本地目录或网址导入' },
      { cmd: 'skill import-from-pi <目录>', desc: '从 pi 项目的配置里导入 package 带的 skill' },
      {
        cmd: 'skill github <仓库>',
        desc: '从 GitHub 仓库导入（--branches 列分支，--import 真导）',
      },
      { cmd: 'skill repos', desc: '列出从 git 仓库导入过的仓库' },
      { cmd: 'skill files list|read|write|delete', desc: '管理 skill 里的文件' },
    ],
  },
  {
    title: 'MCP server',
    hint: '上游 MCP 的定义与工具曝光',
    commands: [
      { cmd: 'mcp list', desc: '列出全部 MCP server' },
      { cmd: 'mcp get <名称>', desc: '看一个 server 的详情' },
      { cmd: 'mcp create <名称>', desc: '新建一个 server' },
      { cmd: 'mcp import <文件>', desc: '从配置文件批量导入 server' },
      { cmd: 'mcp update <名称>', desc: '改一个 server' },
      { cmd: 'mcp delete <名称>', desc: '删一个 server' },
      { cmd: 'mcp enable|disable <名称>', desc: '启用 / 停用' },
      { cmd: 'mcp test <名称>', desc: '测试连接（真实握手 + 拉工具清单）' },
      { cmd: 'mcp connect', desc: '连上所有启用的上游，刷新工具清单' },
      { cmd: 'mcp status', desc: '看代理的整体状态（含每个上游的工具清单）' },
      { cmd: 'mcp probe <名称>', desc: '测一个还没保存的 server 定义' },
      { cmd: 'mcp exposure', desc: '看对外暴露的配置' },
      { cmd: 'mcp set-exposure', desc: '设对外暴露的配置（--all-tools 全放开）' },
      { cmd: 'mcp refresh-token', desc: '刷新访问令牌' },
      { cmd: 'mcp profiles list', desc: '列出配置文件档（一组 server 的组合）' },
      { cmd: 'mcp profiles save <文件>', desc: '覆盖式保存配置文件档' },
      { cmd: 'mcp authorize <名称>', desc: '发起 OAuth 授权（打印授权网址）' },
      { cmd: 'mcp registry <关键词>', desc: '在官方目录里搜 MCP server' },
      { cmd: 'mcp open-url <网址>', desc: '用系统默认浏览器打开一个网址' },
    ],
  },
  {
    title: 'Pi 扩展',
    hint: 'Pi 自带 / npm / 自定义三类',
    commands: [
      { cmd: 'extension list', desc: '列出已安装的扩展' },
      { cmd: 'extension get <名称>', desc: '看一个扩展的详情' },
      { cmd: 'extension install <包名>', desc: '从 npm 装一个扩展到工具箱' },
      { cmd: 'extension remove <名称>', desc: '卸掉工具箱里的一个扩展' },
      { cmd: 'extension create <名称>', desc: '新建一个自定义扩展（用模板打底）' },
      { cmd: 'extension read|write <名称>', desc: '读 / 写自定义扩展的源码' },
      { cmd: 'extension deps <名称> <包…>', desc: '给自定义扩展装 npm 依赖' },
      { cmd: 'extension template', desc: '打印新扩展的模板代码' },
      { cmd: 'extension enable|disable <名称>', desc: '启用 / 停用' },
      { cmd: 'extension search <关键词>', desc: '搜扩展市场（npm registry 上的 pi 扩展包）' },
    ],
  },
  {
    title: '本机 CLI 工具箱',
    hint: 'Claude Code / Codex / Pi 这些 agent CLI',
    commands: [
      { cmd: 'tool list', desc: '列出全部已知的 CLI（含安装状态）' },
      { cmd: 'tool get <命令>', desc: '看一个 CLI 的详情（含所有安装位置）' },
      { cmd: 'tool check-updates', desc: '查 registry 上的最新版本' },
      { cmd: 'tool plan <命令>', desc: '看「将要执行什么」（不真装）' },
      { cmd: 'tool install <命令>', desc: '装一个' },
      { cmd: 'tool upgrade <命令>', desc: '升级一个' },
      { cmd: 'tool uninstall <命令>', desc: '卸一个' },
    ],
  },
  {
    title: '知识库（Wiki）',
    hint: '内部知识库 —— 页面、标签与页面之间的关联',
    commands: [
      { cmd: 'wiki list', desc: '列出知识库里的全部页面' },
      {
        cmd: 'wiki get <slug>',
        desc: '看一个页面的元信息和正文',
        example: 'agentspace wiki get 部署手册',
      },
      { cmd: 'wiki create <标题>', desc: '新建一个页面（slug 由标题生成）' },
      { cmd: 'wiki update <slug>', desc: '改页面的标题、正文、标签或父页面' },
      { cmd: 'wiki delete <slug>', desc: '删一个页面' },
      { cmd: 'wiki search <关键词>', desc: '检索页面' },
      { cmd: 'wiki tags', desc: '列出用过的全部标签' },
      {
        cmd: 'wiki neighbors <slug>',
        desc: '查一个页面的关联页面（引用它的、引用它的、子页面、同标签）',
      },
      { cmd: 'wiki publish <slug>', desc: '把一个页面发布成 Skill' },
    ],
  },
  {
    title: '备份与迁移',
    hint: '把本机数据打包带走，或把别处的数据搬进来',
    commands: [
      { cmd: 'backup inventory', desc: '看本机有哪些数据可以导出' },
      {
        cmd: 'backup export --out <zip>',
        desc: '导出成 zip 包（--all 全带走，可按 agent/skill/mcp/extension/wiki 挑）',
        example: 'agentspace backup export --out backup.zip --all',
      },
      { cmd: 'backup inspect <zip>', desc: '看导入包里有什么、会跟本机撞上什么' },
      {
        cmd: 'backup import <zip>',
        desc: '导入一个 zip 包（--overwrite <key> 覆盖冲突项，--dry-run 只看不动）',
        example: 'agentspace backup import backup.zip --dry-run',
      },
    ],
  },
  {
    title: '桌面端自身',
    hint: '跟 AgentSpace 桌面端有关的事',
    commands: [
      { cmd: 'app update', desc: '查桌面端有没有新版本' },
      {
        cmd: 'version',
        desc: '版本总览：AgentSpace 自己 + 工具箱里各 CLI 工具的版本（也认 -version / -v）',
        example: 'agentspace version --check',
      },
    ],
  },
  {
    title: '全局出站代理',
    commands: [
      { cmd: 'proxy get', desc: '看当前代理状态' },
      { cmd: 'proxy set <地址>', desc: '设置代理地址（空串 = 强制直连）' },
      { cmd: 'proxy test <地址>', desc: '测试某个代理地址通不通' },
      { cmd: 'proxy scan', desc: '扫本机常见的代理端口' },
    ],
  },
]

// ── 界面 ──────────────────────────────────────────────────────

export const pages: HelpPage[] = [
  {
    title: 'Skills',
    desc: '能力包仓库。智能体靠 skill 知道自己能做什么。',
    points: [
      '添加 Skill：手动创建、从本地目录、从网址、从本机运行时（Claude Code / Codex 等）复制、从 GitHub 仓库导入',
      '「从仓库添加」按钮：列出以前导入过的 GitHub 仓库，选一个就能把里面的 skill 再导进来（已导入的再导会更新成最新版本）',
      '漏斗按钮：多级筛选器 —— 按使用状态、数据来源、被谁使用筛，每项带计数',
      '点一行看详情：文件清单与正文都在里面',
      '「更新」按钮：从来源重新拉一遍（本地路径或网址）',
      '状态开关：停用的 skill 不影响智能体，只是不被引用',
    ],
  },
  {
    title: 'MCP 管理',
    desc: '管理上游 MCP server，并决定哪些工具对外暴露。',
    points: [
      '新增 server：填名称、传输方式（http / stdio）、地址或命令',
      '认证方式三种：none（无）、static（固定令牌，支持 ${ENV:NAME} 环境变量占位）、oauth（浏览器授权，也接受直接填 PAT）',
      '「测试」按钮：真实握手并拉工具清单 —— 不是假连接',
      '「从目录添加」：一键选官方目录里的 server（Notion、Linear 等）',
      '工具曝光：决定哪些 server、哪些工具对 agent 可见。父级可全选，子项可单独勾',
      '令牌固定为 AgentSpace，「刷新 token」可重新生成',
    ],
  },
  {
    title: 'Wiki',
    desc: '内部知识库。Markdown 页面，页面之间可以互相引用，智能体能绑定它当知识库。',
    points: [
      '左边页面树，按父子关系分组；新建页面时可以指定父页面',
      '正文用 Markdown 编辑，右边实时预览',
      '搜索：在正文里全文找，命中给出所在行与片段',
      '标签：给页面打标签，用来筛选和找相关页面',
      '页面之间用 [[slug]] 引用 —— 这些引用就是知识图谱的边',
      '「发布为 Skill」：把一页变成 Skill，别的智能体也能用',
      '智能体绑定 Wiki 入口页面后，它的子树连带继承 —— 以后加子页不用改智能体配置',
    ],
  },
  {
    title: 'Agents',
    desc: '本机装了哪些 agent CLI，以及怎么装。',
    points: [
      '「立即检测」：扫本机，找出 Claude Code、Codex、Pi、Gemini CLI 等 14 种 CLI 及其版本与安装位置',
      '「检查更新」：查 registry 上的最新版本',
      '安装 / 升级 / 卸载：点开确认弹窗，里面会列出将要执行的具体命令',
      '版本号下拉：安装时可以挑具体版本，不只装 latest',
      '同一处 CLI 装了多份（比如 nvm 里的和全局的）会分别列出来',
    ],
  },
  {
    title: 'Pi 扩展',
    desc: 'Pi 的扩展是 TypeScript 文件，导出默认工厂函数，Pi 启动时自动加载。',
    points: [
      '三组：Pi 自带（只读，运行时自动加载）、npm（从市场装的）、自定义（自己写的）',
      'npm 市场：搜 npm 上带 pi-package 标签的包，能「加载更多」翻页',
      '自定义扩展：用模板新建，编辑源码，还能装 npm 依赖',
      '只有 npm 与自定义的能绑定到智能体 —— Pi 自带的由运行时自己加载',
      '绑定后 `agentspace run` 会把整个扩展目录（含依赖）复制进项目的 .pi/extensions/',
    ],
  },
  {
    title: '智能体',
    desc: '我们创建的智能体。可绑定能力后交给智能体执行。',
    points: [
      '新建：起名、写指令，绑定 Skill、MCP、Pi 扩展、Wiki 页面',
      '名称唯一 —— 它就是 `agentspace run <名称>` 的业务主键，不允许同名也不允许改名',
      '版本自动管理：新建为 1，每次保存 +1；绑定的 Skill / MCP / 扩展 / Wiki 变了也跟着 +1',
      '列表显示 Skill 数、MCP 数、版本',
      '「复制启动命令」：把 agentspace run 那行拷走直接用',
    ],
  },
  {
    title: '系统设置',
    desc: '命令行安装、数据导入导出、出站代理与应用版本。',
    points: [
      '命令行：显示 `agentspace` 装没装、装在哪 —— 终端里敲不到命令时看这里',
      '数据管理：把智能体、Skills、MCP server、Pi 扩展、Wiki 页面打包导出，也能从别的机器导进来',
      '导出时可选要带走哪些；导入时重名的默认不覆盖，勾了「覆盖」才替换本机那份',
      '网络：全局出站代理 —— 技能下载、版本检查、MCP 目录搜索都经它；留空即直连',
      '显示当前应用版本',
      '「检查最新版本」：有新版时按钮变成「更新到 X.Y.Z」，下载与安装都在应用内完成，装完自动重启',
    ],
  },
]

// ── 通用约定 ──────────────────────────────────────────────────

/** 命令行特有的约定。 */
export const commandConventions: string[] = [
  '每条命令都支持 --json，给 agent 拿去解析（等价于 --format json）',
  '退出码：0 成功，1 操作失败，2 参数不对，3 找不到',
  '智能体名找不到时会列出可用的智能体 —— 名字是唯一的业务主键',
  '装扩展依赖需要 node 环境（会调 npm）',
]

/** 界面通用的约定。 */
export const pageConventions: string[] = [
  '数据都落在 ~/.agent-compose/ 下 —— 桌面端与命令行操作的是同一份',
  '智能体绑定的是相对引用：skill 存 skills/<目录名>，MCP 存 mcp/servers.json#<id>，扩展存 extensions/<来源>/<目录名>。改名只改一处',
  '智能体版本自动管理：新建为 1，每次保存 +1；绑定的 Skill / MCP / 扩展 / Wiki 变了也跟着 +1',
  'MCP 令牌固定是 AgentSpace，可在 MCP 页随时刷新',
  'Wiki 页面存在 ~/.agent-compose/wiki/<slug>/ —— 正文是 page.md，元信息在 .meta.json',
  '右上角铃铛是操作通知 —— 安装、升级、删除的进度与结果都在那里',
]

export const helpTopics: HelpTopic[] = [
  { key: 'command', label: '命令行', kind: 'command' },
  { key: 'page', label: '界面', kind: 'page' },
  { key: 'version', label: '版本', kind: 'version' },
]
