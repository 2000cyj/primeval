<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NIcon, NInput, NRadio, NSpin, useMessage } from 'naive-ui'
import { ArrowLeft, Copy, Monitor, Search, X } from 'lucide-vue-next'
import { scanAgents, type AgentInfo, type PackagePlan } from '@/api/agents'
import { agentIconBgOf, agentIconOf } from '@/data/agentIcons'
import type { CreatedAgentInput } from '@/data/createdAgents'
import { useCreatedAgents } from '@/data/createdAgents'
import AgentConfigForm from '@/components/AgentConfigForm.vue'
import PackageOpModal from '@/components/PackageOpModal.vue'
import { setUpgradeDoneHandler, useCliOps } from '@/composables/useCliOps'

const emit = defineEmits<{ cancel: []; done: [agent: CreatedAgentInput] }>()

const message = useMessage()
const { performOp } = useCliOps()
const { add, hasName } = useCreatedAgents()

/** 当前步骤：1 选择运行时 / 2 配置 */
const step = ref<1 | 2>(1)

/** Pi 的安装命令（没装时告诉用户怎么装） */
const PI_INSTALL_COMMAND = 'npm i -g @earendil-works/pi-coding-agent@latest'

/** 本机探测到的 agent —— 跟 agents 页用同一套探测逻辑 */
const agents = ref<AgentInfo[]>([])
/** 正在探测（搜索中） */
const scanning = ref(false)
/** 搜索关键字 */
const keyword = ref('')

const loadAgents = async () => {
  scanning.value = true
  try {
    agents.value = await scanAgents()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    agents.value = []
  } finally {
    scanning.value = false
  }
}

/** 搜索结果：在探测到的 agent 里筛 */
const visibleAgents = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return agents.value
  return agents.value.filter((agent) =>
    `${agent.name}${agent.command}`.toLowerCase().includes(word),
  )
})

/** Pi（目前只支持它） */
const piAgent = computed(() => agents.value.find((agent) => agent.command === 'pi'))
const piInstalled = computed(() => piAgent.value?.installed === true)

/** 选中的 agent（只有 Pi 能选） */
const selectedHarness = ref<'pi' | null>(null)

const selectAgent = (agent: AgentInfo) => {
  if (agent.command !== 'pi') return
  selectedHarness.value = 'pi'
}

/* ---------- 没装 Pi：给安装按钮 ---------- */

/** 安装 Pi 的确认弹窗（与 agents 页共用） */
const installModalOpen = ref(false)

const openInstallPi = () => {
  installModalOpen.value = true
}

/** 确认后转后台安装（进度在顶栏通知里） */
const confirmInstallPi = (plan: PackagePlan) => {
  installModalOpen.value = false
  void performOp({
    command: plan.command,
    name: plan.name,
    target: '',
    commandLine: plan.commandLine,
    op: 'install',
    version: plan.version,
  })
}

const copyInstallCommand = async () => {
  await navigator.clipboard?.writeText(PI_INSTALL_COMMAND)
  message.success('安装命令已复制')
}

onMounted(() => {
  void loadAgents()
  // 装完（或升级完）重新探一遍：Pi 可能就装上了
  setUpgradeDoneHandler(() => loadAgents())
})

onBeforeUnmount(() => {
  setUpgradeDoneHandler(null)
})

/* ---------- 第二步：配置 ---------- */

const name = ref('')
const description = ref('')
const instruction = ref('')
/** 已选 skills（相对路径引用） */
const selectedSkills = ref<string[]>([])
/** 已选 MCP server（相对路径引用） */
const selectedMcpServers = ref<string[]>([])
/** 已选 Pi 扩展（相对扩展库的引用） */
const selectedExtensions = ref<string[]>([])

const goNext = () => {
  if (!piInstalled.value) {
    message.warning('Pi 还没装 —— 先装好再继续')
    return
  }
  if (!selectedHarness.value) {
    selectedHarness.value = 'pi'
  }
  step.value = 2
}

const submit = async (): Promise<void> => {
  if (!name.value.trim()) {
    message.warning('请填写智能体名称')
    return
  }
  // 名字是智能体的唯一标识（agentspace run <名称> 按名字找）→ 不允许重名
  if (hasName(name.value)) {
    message.warning(`已经有同名智能体了：${name.value.trim()}`)
    return
  }
  // 落盘：列表数据进 agent.json，指令进同目录的 AGENTS.md
  try {
    await add({
      name: name.value.trim(),
      description: description.value.trim(),
      instruction: instruction.value.trim(),
      skills: selectedSkills.value,
      mcpServers: selectedMcpServers.value,
      extensions: selectedExtensions.value,
      // 现在只支持 Pi（第一步只能选 Pi）
      runtime: 'pi',
    })
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    return
  }
  emit('done', {
    name: name.value.trim(),
    description: description.value.trim(),
    instruction: instruction.value.trim(),
    skills: selectedSkills.value,
    mcpServers: selectedMcpServers.value,
    extensions: selectedExtensions.value,
  })
  message.success(`已创建智能体：${name.value.trim()}`)
}
</script>

<template>
  <section class="wizard">
    <header class="wizard-head">
      <div class="head-left">
        <NButton
          quaternary
          circle
          size="small"
          aria-label="返回"
          @click="step === 2 ? (step = 1) : emit('cancel')"
        >
          <template #icon>
            <NIcon :size="16">
              <ArrowLeft v-if="step === 2" />
              <X v-else />
            </NIcon>
          </template>
        </NButton>
        <div class="head-text">
          <span class="head-title">创建智能体</span>
          <span class="head-sub">{{ step === 1 ? '选择运行时' : '配置' }}</span>
        </div>
      </div>

      <ol class="steps">
        <li class="step" :class="{ done: step > 1, active: step === 1 }">
          <span class="step-dot">1</span>
          <span class="step-label">选择运行时</span>
        </li>
        <li class="step-line" />
        <li class="step" :class="{ active: step === 2 }">
          <span class="step-dot">2</span>
          <span class="step-label">配置</span>
        </li>
      </ol>
    </header>

    <!-- 第一步：选择运行时 -->
    <div v-if="step === 1" class="wizard-body">
      <div class="body-head">
        <h2 class="body-title">这个智能体在哪里运行？</h2>
        <NInput
          v-model:value="keyword"
          class="search"
          size="small"
          clearable
          placeholder="搜索 harness 或机器"
        >
          <template #prefix>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
        </NInput>
      </div>

      <div class="groups">
        <section class="group">
          <header class="group-head">
            <NIcon :size="14" color="var(--c-text-3)">
              <Monitor />
            </NIcon>
            <span class="group-title">智能体</span>
            <span class="group-count tnum">1</span>
          </header>

          <ul class="harness-list">
            <!-- 搜索中 / 探测中 -->
            <li v-if="scanning" class="harness-loading">
              <NSpin size="small" />
              <span>正在检测本机 agent…</span>
            </li>

            <!-- 没找到 Pi：给安装按钮 -->
            <li v-else-if="!piInstalled" class="install-hint">
              <span class="install-text">没检测到 Pi，装一个就能跑智能体了：</span>
              <NButton type="primary" size="tiny" @click="openInstallPi">安装 Pi</NButton>
              <code class="install-cmd mono">{{ PI_INSTALL_COMMAND }}</code>
              <NButton quaternary size="tiny" aria-label="复制安装命令" @click="copyInstallCommand">
                <template #icon>
                  <NIcon :size="12">
                    <Copy />
                  </NIcon>
                </template>
              </NButton>
            </li>

            <!-- 探测到的 agent（目前只有 Pi 能选） -->
            <li
              v-for="agent in visibleAgents"
              :key="agent.id"
              class="harness-item"
              :class="{ disabled: agent.command !== 'pi' }"
            >
              <NRadio
                :checked="selectedHarness === 'pi' && agent.command === 'pi'"
                class="harness-radio"
                :disabled="agent.command !== 'pi'"
                @update:checked="selectAgent(agent)"
              >
                <span class="harness-content">
                  <span class="harness-icon" :style="{ background: agentIconBgOf(agent.command) }">
                    <img class="harness-icon-img" :src="agentIconOf(agent.command)" alt="" />
                  </span>
                  <span class="harness-name">{{ agent.name }}</span>
                  <span class="harness-version mono">
                    {{ agent.version ?? (agent.installed ? '已安装' : '未安装') }}
                  </span>
                  <!-- 暂不支持的 agent：右边标一个「未适配」 -->
                  <span v-if="agent.command !== 'pi'" class="harness-tag">未适配</span>
                </span>
              </NRadio>
            </li>

            <li v-if="!scanning && !visibleAgents.length && piInstalled" class="harness-loading">
              <span>没有匹配的 agent</span>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- 第二步：配置 -->
    <div v-else class="wizard-body">
      <div class="body-head">
        <h2 class="body-title">配置智能体</h2>
      </div>

      <AgentConfigForm
        v-model:name="name"
        v-model:description="description"
        v-model:instruction="instruction"
        v-model:skills="selectedSkills"
        v-model:mcp-servers="selectedMcpServers"
        v-model:extensions="selectedExtensions"
      />
    </div>

    <!-- 没装 Pi 时的安装确认（与 agents 页共用同一个弹窗） -->
    <PackageOpModal
      :show="installModalOpen"
      op="install"
      command="pi"
      name="Pi"
      @close="installModalOpen = false"
      @confirm="confirmInstallPi"
    />

    <footer class="wizard-foot">
      <span class="foot-hint">
        <template v-if="step === 1">
          <template v-if="piInstalled">已选：Pi {{ piAgent?.version }}</template>
          <template v-else>Pi 未安装 —— 先按上面的命令装好</template>
        </template>
        <template v-else>创建后可在智能体列表中继续调整</template>
      </span>
      <div class="foot-actions">
        <NButton size="small" @click="step === 1 ? emit('cancel') : (step = 1)">
          {{ step === 1 ? '取消' : '返回' }}
        </NButton>
        <NButton v-if="step === 1" size="small" type="primary" @click="goNext">下一步</NButton>
        <NButton v-else size="small" type="primary" @click="submit">创建智能体</NButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.wizard {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: var(--c-bg);
}

/* 顶栏 */
.wizard-head {
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

/* 步骤条 */
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-4);
}

.step.active {
  color: var(--c-text);
  font-weight: 500;
}

.step.done {
  color: var(--c-text-3);
}

.step-dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #eceef1;
  font-size: 10px;
  font-weight: 600;
  color: var(--c-text-3);
}

.step.active .step-dot {
  background: var(--c-accent);
  color: #fff;
}

.step.done .step-dot {
  background: #d8f3e6;
  color: var(--c-success);
}

.step-label {
  white-space: nowrap;
}

.step-line {
  width: 32px;
  height: 1px;
  background: var(--c-border);
}

/* 主体 */
.wizard-body {
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

.search {
  width: 240px;
}

/* 分组 */
.groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
  margin: 0 auto;
}

.group {
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--c-border);
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.group-count {
  font-size: 11px;
  color: var(--c-text-4);
}

/* harness 列表 */
.harness-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--c-border);
}

.harness-item {
  border-left: 2px solid transparent;
}

.harness-item:has(.n-radio--checked) {
  border-left-color: var(--c-accent);
  background: #f5f6ff;
}

.harness-item:hover {
  background: var(--c-surface-sunken);
}

.harness-item.disabled {
  opacity: 0.55;
}

/* 探测中 */
.harness-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  font-size: 12px;
  color: var(--c-text-3);
}

/* 没装时的安装路径 */
.install-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid var(--c-border);
  background: #fff7ed;
  font-size: 12px;
  color: var(--c-text-2);
}

.install-text {
  flex: none;
}

.install-cmd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  font-family: var(--c-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--c-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.harness-radio {
  width: 100%;
  padding: 9px 14px;
}

.harness-radio :deep(.n-radio__label) {
  width: 100%;
}

.harness-content {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.harness-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
}

.harness-icon-img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.harness-name {
  font-size: 13px;
  color: var(--c-text);
}

.harness-version {
  font-size: 11px;
  color: var(--c-text-4);
}

/* 暂不支持的 agent：灰色的「未适配」 */
.harness-tag {
  flex: none;
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--c-surface-sunken);
  font-size: 10px;
  color: var(--c-text);
}

/* 表单卡片在 AgentConfigForm 里（新建与编辑共用一份） */

/* 底栏 */
.wizard-foot {
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
  color: var(--c-text-3);
}

.foot-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 760px) {
  .field {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
