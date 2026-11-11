/**
 * 模型厂商 / AI 服务图标。
 *
 * 来源：https://github.com/farion1231/cc-switch （MIT License）
 *       原路径：src/icons/extracted/*.svg
 * 用途：作为智能体（agent）的品牌图标。
 *
 * 图标文件是从 cc-switch 原样拿过来的（逐字节一致），别在这里改画。
 * agent → 图标的对应关系见 `views/AgentsView.vue` 的 `iconOf`。
 *
 * 例外：`pi.svg` / `omp.svg` 在 cc-switch 里是内联在
 * `icons/extracted/index.ts` 里的字符串，没有独立文件 —— 这里是从那段
 * 索引里原样提取出来的。
 *
 * 注意：部分图标使用 `fill="currentColor"`，作为 <img> 渲染时呈黑色；
 * 放在浅色底的图标块里显示正常。
 */
import aihubmixColor from '@/assets/agent-icons/aihubmix-color.svg'
import antigravity from '@/assets/agent-icons/antigravity.svg'
import alibaba from '@/assets/agent-icons/alibaba.svg'
import anthropic from '@/assets/agent-icons/anthropic.svg'
import baidu from '@/assets/agent-icons/baidu.svg'
import bytedance from '@/assets/agent-icons/bytedance.svg'
import chatglm from '@/assets/agent-icons/chatglm.svg'
import claude from '@/assets/agent-icons/claude.svg'
import claw from '@/assets/agent-icons/claw.svg'
import copilot from '@/assets/agent-icons/copilot.svg'
import deepseek from '@/assets/agent-icons/deepseek.svg'
import doubao from '@/assets/agent-icons/doubao.svg'
import gemini from '@/assets/agent-icons/gemini.svg'
import gemma from '@/assets/agent-icons/gemma.svg'
import github from '@/assets/agent-icons/github.svg'
import githubcopilot from '@/assets/agent-icons/githubcopilot.svg'
import hermes from '@/assets/agent-icons/hermes.png'
import google from '@/assets/agent-icons/google.svg'
import grok from '@/assets/agent-icons/grok.svg'
import huggingface from '@/assets/agent-icons/huggingface.svg'
import huawei from '@/assets/agent-icons/huawei.svg'
import hunyuan from '@/assets/agent-icons/hunyuan.svg'
import kimi from '@/assets/agent-icons/kimi.svg'
import mcp from '@/assets/agent-icons/mcp.svg'
import meta from '@/assets/agent-icons/meta.svg'
import minimax from '@/assets/agent-icons/minimax.svg'
import mistral from '@/assets/agent-icons/mistral.svg'
import nvidia from '@/assets/agent-icons/nvidia.svg'
import ollama from '@/assets/agent-icons/ollama.svg'
import openai from '@/assets/agent-icons/openai.svg'
import opencode from '@/assets/agent-icons/opencode-logo-light.svg'
import omp from '@/assets/agent-icons/omp.svg'
import openrouter from '@/assets/agent-icons/openrouter.svg'
import perplexity from '@/assets/agent-icons/perplexity.svg'
import pi from '@/assets/agent-icons/pi.svg'
import qwen from '@/assets/agent-icons/qwen.svg'
import qwencloud from '@/assets/agent-icons/qwencloud.svg'
import siliconflow from '@/assets/agent-icons/siliconflow.svg'
import stepfun from '@/assets/agent-icons/stepfun.svg'
import tencent from '@/assets/agent-icons/tencent.svg'
import xai from '@/assets/agent-icons/xai.svg'
import yi from '@/assets/agent-icons/yi.svg'
import zhipu from '@/assets/agent-icons/zhipu.svg'

export const agentIcons = {
  aihubmix: aihubmixColor,
  antigravity,
  alibaba,
  anthropic,
  baidu,
  bytedance,
  chatglm,
  claude,
  claw,
  copilot,
  deepseek,
  doubao,
  gemini,
  gemma,
  github,
  githubcopilot,
  hermes,
  google,
  grok,
  huggingface,
  huawei,
  hunyuan,
  kimi,
  mcp,
  meta,
  minimax,
  mistral,
  nvidia,
  ollama,
  openai,
  opencode,
  omp,
  openrouter,
  perplexity,
  pi,
  qwen,
  qwencloud,
  siliconflow,
  stepfun,
  tencent,
  xai,
  yi,
  zhipu,
} as const

export type AgentIconKey = keyof typeof agentIcons

/**
 * 命令名 → 品牌图标。
 *
 * 工具列表跟 cc-switch 完全对齐（见 `src-tauri/src/agents.rs` 的 AGENT_SPECS），
 * 图标也全是 cc-switch 的那套（`src/icons/extracted/*`，原样拿过来；
 * 它索引里内联的 pi / omp 也一并提取成文件了）。
 */
export const agentIconOf = (command: string): string => {
  const map: Record<string, string> = {
    claude: agentIcons.claude,
    codex: agentIcons.openai,
    gemini: agentIcons.gemini,
    grok: agentIcons.grok,
    opencode: agentIcons.opencode,
    openclaw: agentIcons.claw,
    hermes: agentIcons.hermes,
    pi: agentIcons.pi,
    omp: agentIcons.omp,
    mcode: agentIcons.minimax,
    kimi: agentIcons.kimi,
    dsh: agentIcons.deepseek,
    agy: agentIcons.antigravity,
    copilot: agentIcons.githubcopilot,
  }
  return map[command] ?? agentIcons.openai
}

/**
 * 图标底色。
 *
 * cc-switch 的应用色（`bg-*-500/10` 叠在白底上）算出来的实际色值，
 * 跟它一个颜色体系。
 */
export const agentIconBgOf = (command: string): string => {
  const map: Record<string, string> = {
    claude: '#FEF1E8', // orange-500/10
    codex: '#E9F9EF', // green-500/10
    gemini: '#EBF3FE', // blue-500/10
    grok: '#E6F8FB', // cyan-500/10
    opencode: '#EFF0FE', // indigo-500/10
    openclaw: '#FEECEF', // rose-500/10
    hermes: '#F3EFFE', // violet-500/10
    pi: '#FBEFFE', // fuchsia-500/10
    omp: '#E6F8FB', // cyan-500/10
    mcode: '#FEF1E8', // orange-500/10
    kimi: '#EBF3FE', // blue-500/10
    dsh: '#EBF3FE', // blue-500/10
    agy: '#E7F6FD', // sky-500/10
    copilot: '#F0F1F3', // slate-500/10
  }
  return map[command] ?? '#F1F5F9'
}
