# agentspace —— AgentSpace 命令行

AgentSpace 的命令行入口。跟桌面端（`apps/AgentCompose`）**操作同一份数据**。

## 设计：抄 multica 的路子

multica（<https://github.com/multica-ai/multica>）的做法是
**一套后端 API，两个客户端**：

```
server/                     一个 Go module
├── cmd/multica/            ← CLI
├── cmd/server/             ← HTTP 服务
└── internal/               ← 共享实现（CLI 和服务端都 import 它）
```

我们没有服务端，但原则一样：

```
apps/agentspace-core/       ← 共享实现（数据长什么样 + 怎么读写）
├── apps/AgentCompose/      ← 桌面端（Tauri）
└── apps/agentspace-cli/    ← CLI
```

- **数据的结构定义只有一份** —— 以前两边各写一份 `agent.json` 的结构，
  加字段要改两处，迟早漂移。
- **MCP 的操作走 sidecar 的 admin HTTP API** —— 桌面端和 CLI 是同一个 API
  的两个客户端。

## 命令树

```
agentspace
├── run <名称>              准备目录并启动智能体（当前只支持 Pi）
├── agent                   智能体（我们创建的）
│   ├── list / get / create / update / delete / copy
│   ├── skills list|add|remove
│   └── mcp    list|add|remove
├── skill                   Skill 仓库
│   ├── list / get / create / update / delete / duplicate
│   ├── enable / disable / refresh / import
│   └── files list|read|write|delete
├── mcp                     MCP server
│   ├── list / get / create / update / delete
│   ├── enable / disable / test / connect / status / probe
│   ├── exposure get|set
│   └── refresh-token
├── extension               Pi 扩展（Pi 自带 / npm / 自定义）
│   ├── list / get / install / remove
│   ├── create / read / write / template
│   ├── enable / disable
│   └── search
├── tool                    本机 CLI 工具箱
│   ├── list / get / check-updates / plan
│   └── install / upgrade / uninstall
└── proxy                   全局出站代理
    └── get / set / test / scan
```

## 给 agent 用

每条命令都支持两种输出：

```bash
agentspace agent list              # 给人看的表格
agentspace agent list --json       # 给 agent 解析的 JSON
```

`--json` 和 `--format json` 等价。

退出码：

| 码  | 意思                                |
| --- | ----------------------------------- |
| 0   | 成功                                |
| 1   | 操作失败（文件写不了、代理连不上…） |
| 2   | 参数不对 / 没装                     |
| 3   | 找不到（智能体、skill、server…）    |

## 例子

```bash
# 看有什么
agentspace agent list
agentspace skill list
agentspace mcp list
agentspace extension list
agentspace tool list

# 建一个智能体并绑能力
agentspace agent create 知识助手 \
  --description "查文档" \
  --instruction "只根据知识库回答" \
  --skill skills/knowledge-base \
  --mcp filesystem

# 写一个 skill
agentspace skill create my-skill --description "干什么用的" --body "正文"

# 起一个智能体
cd 我的项目 && agentspace run 知识助手
```

`run` 会把智能体的能力落到**当前目录**：

```
.pi/AGENTS.md          智能体指令
.pi/skills/<名字>/     复制的 skill
.pi/mcp.json           MCP 配置（每个上游一条）
.pi/extensions/        agentspace 的 Pi 扩展
.pi/agentspace.json    落地记录（版本号）
```

之后在那个目录直接跑 `pi` 也能用 —— 项目已经登记进 Pi 的信任名单了。

## 开发

```bash
node scripts/build-cli.mjs          # 在 apps/AgentCompose 下构建
cargo test --bin agentspace         # 在 apps/agentspace-cli 下测试
```

改 `apps/agentspace-core/` 里的东西，两个端都跟着变 —— 桌面端要重新
`cargo build`，CLI 要重新构建。
