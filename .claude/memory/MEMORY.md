# 项目记忆索引

AgentSpace（AI 工具箱）的事实记录。**代码里能查到的就别写这里** —— 这里只放
跨会话需要记住的约定和易踩的坑。

## 目录结构

| 位置                         | 内容                              |
| ---------------------------- | --------------------------------- |
| `apps/AgentCompose`          | 桌面端（Tauri + Vue 3）           |
| `apps/agentspace-core`       | 共享 Rust crate `agentspace_core` |
| `apps/agentspace-cli`        | `agentspace` 命令行               |
| `packages/agent-compose-mcp` | MCP sidecar                       |

## 数据都落在 `~/.agent-compose/`

| 路径                        | 内容                                          |
| --------------------------- | --------------------------------------------- |
| `agents/<id>/agent.json`    | 智能体定义                                    |
| `agents/<id>/AGENTS.md`     | 智能体的指令                                  |
| `skills/<目录名>/`          | Skill 仓库                                    |
| `extensions/npm/<名>/`      | 工具箱里的 npm 扩展（含各自的 node_modules）  |
| `extensions/custom/<名>/`   | 工具箱里的自定义扩展                          |
| `mcp/servers.json`          | MCP server 定义                               |
| `mcp/exposure.json`         | 工具曝光配置                                  |
| `mcp/tools.json`            | 上游工具清单缓存                              |
| `mcp/port`、`mcp/token`     | sidecar 的端口与令牌（令牌固定 `AgentSpace`） |
| `git/<host>/<owner>/<仓库>` | git 源的本地克隆                              |

## 约定

- **智能体名称唯一** —— 它是 `agentspace run <名称>` 的业务主键。
- **绑定存相对引用** —— skill 存 `skills/<目录名>`，MCP 存 `mcp/servers.json#<id>`，
  Pi 扩展存 `extensions/<来源>/<目录名>`。改名只改一处。
- **桌面端与 CLI 共用 `agentspace-core`** —— 字段定义和读写逻辑只有一份，
  不会出现「界面说装了、CLI 说没装」。
- **npm 扩展不进 pi 全局目录** —— 放工具箱里，只在绑定到智能体后由
  `agentspace run` 复制进项目的 `.pi/extensions/`。
- **版本由后端统一管理** —— 新建为 1，保存更新为旧值 +1，绑定的
  Skill / MCP / Pi 扩展变更也联动递增。
- **只验证代码，不跑界面** —— typecheck + lint + cargo check 就算做完。
