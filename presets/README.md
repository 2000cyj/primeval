# 定制化预设：全栈开发工程师

`fullstack-engineer.zip` —— 一个可直接导入的 AgentSpace 数据包，
装出来就是这台机器上用的那个 **全栈开发工程师** 智能体
（`agent-java8-vue3`）。

## 包里有什么

| 类别       | 数量 | 说明                                                             |
| ---------- | ---- | ---------------------------------------------------------------- |
| 智能体     | 1    | `agent-java8-vue3` —— Java 8 / Spring Boot 2.7 后端 + Vue 3 前端 |
| Skill      | 48   | 13 个本地手写 + 35 个远程（记来源，导入时重新拉）                |
| MCP server | 3    | `idea` / `context-mode` / `xerj`                                 |
| Pi 扩展    | 5    | 4 个 npm（记包名，导入时重装）+ 1 个自定义（打包原文件）         |
| Wiki 页面  | 0    | 这个智能体没绑知识库                                             |

智能体的指令正文在 `agents/<id>/AGENTS.md` 里，一起打包带走。

## 怎么导入

```console
$ agentspace backup import presets/fullstack-engineer.zip
```

或者在桌面端：**系统设置 › 数据管理 › 导入数据**。

导入是**增量**的：已有的同名项默认不覆盖，冲突清单里可以逐项勾选覆盖。

## 导入后会发生什么

- **本地 skill**：从包里还原原文件（`SKILL.md` + 附属文件）
- **远程 skill**：按记录下来的仓库地址和 ref 重新 clone。
  清单里还记了它在仓库里的**真实路径** —— 同一个仓库里 skill 的位置不统一
  （`skills/<名>/`、`skills/<组>/<名>/`、甚至仓库根），记下来才不会认错
- **npm 扩展**：按包名 `npm install` 一遍
- **自定义扩展**：从包里还原文件（不含 `node_modules`）

## 已知边界

- npm 扩展和远程 skill 导入时**要联网**
- 导出的是**配置数据**，不是程序本体
- OAuth 令牌、`tools.json` 缓存、agent 运行历史不在包里 ——
  敏感或没有意义
