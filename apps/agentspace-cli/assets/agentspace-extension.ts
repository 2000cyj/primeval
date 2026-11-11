/**
 * agentspace 的 Pi 扩展。
 *
 * 职责：把 `.pi/AGENTS.md`（智能体指令）注入 system prompt。
 *
 * 为什么需要这个扩展 —— Pi 的 context 文件发现只看**工作目录和它的父目录**，
 * 不看 `.pi/`。所以 agentspace 把指令放在 `.pi/AGENTS.md`，
 * 由这个扩展在 `before_agent_start` 时挂进 `contextFiles`，
 * Pi 会按原生 context 文件的格式渲染它：
 *
 * ```
 * <project_context>
 * Project-specific instructions and guidelines:
 *
 * <project_instructions path="<cwd>/.pi/AGENTS.md">
 * ...指令正文...
 * </project_instructions>
 * </project_context>
 * ```
 *
 * 挂进 `contextFiles` 而不是自己拼 `systemPrompt`：
 * 拼整段 system prompt 会把 Pi 自己的规则、工具清单、skills 提示全顶掉；
 * 走 `contextFiles` 则是增量 —— Pi 会 diff 出变化的 section 只打补丁。
 *
 * 覆盖语义跟 Pi 自己一致：同目录下的 `AGENTS.override.md` 顶掉 `AGENTS.md`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function (pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const dir = join(ctx.cwd, '.pi')
    const overridePath = join(dir, 'AGENTS.override.md')
    const mainPath = join(dir, 'AGENTS.md')

    // 和 Pi 一样的语义：override 存在就顶掉 AGENTS.md
    const path = existsSync(overridePath) ? overridePath : mainPath
    if (!existsSync(path)) return

    let content: string
    try {
      content = readFileSync(path, 'utf8')
    } catch {
      // 读不到就当没这个文件，不该把整个 agent 拖垮
      return
    }
    if (!content.trim()) return

    const files = event.systemPromptOptions.contextFiles
    const existing = files.find((file) => file.path === path)
    if (existing) {
      // 同一轮里重复触发时刷新内容，不重复挂载
      existing.content = content
      return
    }
    files.push({ path, content })
  })
}
