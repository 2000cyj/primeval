<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NTooltip, useMessage } from 'naive-ui'
import { ArrowLeft, Copy } from 'lucide-vue-next'
import AgentConfigForm from '@/components/AgentConfigForm.vue'
import { useCreatedAgents } from '@/data/createdAgents'

/**
 * 编辑智能体。
 *
 * 字段与新建向导第二步完全一样 —— 共用 AgentConfigForm。
 */
const props = defineProps<{ agentId: string }>()

const emit = defineEmits<{ cancel: []; saved: [] }>()

const message = useMessage()
const { createdAgents, update, hasName } = useCreatedAgents()

/** 要编辑的智能体（列表里被删了就找不到） */
const agent = computed(() => createdAgents.value.find((item) => item.id === props.agentId))

/* 本地副本：改到一半不保存，列表里也不该变 */
const name = ref('')
const description = ref('')
const instruction = ref('')
const skills = ref<string[]>([])
const mcpServers = ref<string[]>([])
/** 绑定的 Pi 扩展（相对扩展库的引用） */
const extensions = ref<string[]>([])

/** 把智能体的当前值灌进表单 */
const load = (): void => {
  const current = agent.value
  if (!current) return
  name.value = current.name
  description.value = current.description
  instruction.value = current.instruction
  skills.value = [...current.skills]
  mcpServers.value = [...current.mcpServers]
  extensions.value = [...(current.extensions ?? [])]
}

watch(agent, load, { immediate: true })

const save = async (): Promise<void> => {
  const current = agent.value
  if (!current) {
    message.error('智能体不存在了')
    emit('cancel')
    return
  }
  if (!name.value.trim()) {
    message.warning('请填写智能体名称')
    return
  }
  // 改名也不能撞上别的智能体（名字是唯一标识）
  if (hasName(name.value, current.id)) {
    message.warning(`已经有同名智能体了：${name.value.trim()}`)
    return
  }
  try {
    await update(current.id, {
      name: name.value.trim(),
      description: description.value.trim(),
      instruction: instruction.value.trim(),
      skills: skills.value,
      mcpServers: mcpServers.value,
      extensions: extensions.value,
    })
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    return
  }
  message.success(`已保存：${name.value.trim()}`)
  emit('saved')
}

/**
 * 在终端里跑这个智能体的命令。
 *
 * 名称是命令的一部分 —— 名称改了命令也跟着变，所以这里跟着 name 走。
 */
const runCommand = computed(() => `agentspace run ${name.value.trim()}`)

const copyRunCommand = (): void => {
  void navigator.clipboard?.writeText(runCommand.value)
  message.success('已复制启动命令')
}
</script>

<template>
  <section class="edit">
    <header class="edit-head">
      <div class="head-left">
        <NButton quaternary circle size="small" aria-label="返回" @click="emit('cancel')">
          <template #icon>
            <NIcon :size="16">
              <ArrowLeft />
            </NIcon>
          </template>
        </NButton>
        <div class="head-text">
          <span class="head-title">编辑智能体</span>
          <span class="head-sub">{{ agent?.name ?? '智能体不存在' }}</span>
        </div>
      </div>
    </header>

    <div class="edit-body">
      <div class="body-head">
        <h2 class="body-title">配置智能体</h2>
      </div>

      <AgentConfigForm
        v-model:name="name"
        v-model:description="description"
        v-model:instruction="instruction"
        v-model:skills="skills"
        v-model:mcp-servers="mcpServers"
        v-model:extensions="extensions"
      />

      <section class="card run-card">
        <h3 class="card-title">在终端运行</h3>
        <p class="run-hint">
          在项目目录里敲这条命令，会把绑定的 Skills、指令和 MCP 落到当前目录， 然后用 Pi
          打开这个智能体。
        </p>
        <div class="run-cmd">
          <code class="run-code">{{ runCommand }}</code>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton size="tiny" secondary aria-label="复制启动命令" @click="copyRunCommand">
                <template #icon>
                  <NIcon :size="13">
                    <Copy />
                  </NIcon>
                </template>
              </NButton>
            </template>
            复制命令
          </NTooltip>
        </div>
      </section>
    </div>

    <footer class="edit-foot">
      <span class="foot-hint">保存后立即生效</span>
      <div class="foot-actions">
        <NButton size="small" @click="emit('cancel')">取消</NButton>
        <NButton size="small" type="primary" @click="save">保存</NButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.run-card {
  max-width: 720px;
  margin: 16px auto 0;
}

.run-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.run-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 6px;
}

.run-code {
  flex: 1;
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  color: var(--c-text);
  word-break: break-all;
}

.edit {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: var(--c-bg);
}

.edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}

.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.head-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.head-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.head-sub {
  font-size: 11px;
  color: var(--c-text-3);
}

.edit-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 28px;
}

.body-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 720px;
  margin: 0 auto 16px;
}

.body-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.edit-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: var(--c-surface);
  border-top: 1px solid var(--c-border);
}

.foot-hint {
  font-size: 12px;
  color: var(--c-text-4);
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
