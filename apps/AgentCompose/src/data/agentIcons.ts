/**
 * 模型厂商 / AI 服务图标。
 *
 * 来源：https://github.com/farion1231/cc-switch （MIT License）
 *       原路径：src/icons/extracted/*.svg
 * 用途：作为智能体（agent）的品牌图标。
 *
 * 注意：部分图标使用 `fill="currentColor"`，作为 <img> 渲染时呈黑色；
 * 放在浅色底的图标块里显示正常。
 */
import aihubmixColor from '@/assets/agent-icons/aihubmix-color.svg'
import alibaba from '@/assets/agent-icons/alibaba.svg'
import anthropic from '@/assets/agent-icons/anthropic.svg'
import baidu from '@/assets/agent-icons/baidu.svg'
import bytedance from '@/assets/agent-icons/bytedance.svg'
import chatglm from '@/assets/agent-icons/chatglm.svg'
import claude from '@/assets/agent-icons/claude.svg'
import copilot from '@/assets/agent-icons/copilot.svg'
import deepseek from '@/assets/agent-icons/deepseek.svg'
import doubao from '@/assets/agent-icons/doubao.svg'
import gemini from '@/assets/agent-icons/gemini.svg'
import gemma from '@/assets/agent-icons/gemma.svg'
import github from '@/assets/agent-icons/github.svg'
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
import openrouter from '@/assets/agent-icons/openrouter.svg'
import perplexity from '@/assets/agent-icons/perplexity.svg'
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
  alibaba,
  anthropic,
  baidu,
  bytedance,
  chatglm,
  claude,
  copilot,
  deepseek,
  doubao,
  gemini,
  gemma,
  github,
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
  openrouter,
  perplexity,
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
