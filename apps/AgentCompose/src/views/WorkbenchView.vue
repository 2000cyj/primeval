<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NRadioButton, NRadioGroup, NSpace, NTooltip, useMessage } from 'naive-ui'
import { ChevronRight, Plus } from 'lucide-vue-next'
import { cliAgents } from '@/data/agents'
import { skills, type Skill } from '@/data/skills'
import { mcpServices } from '@/data/mcps'
import BindCapabilityModal, { type BindItem } from '@/components/BindCapabilityModal.vue'

const message = useMessage()

/**
 * 每个智能体已绑定的能力。设计稿只定义了 Claude Code，其余按 skillsCount 分配。
 */
const boundSkillNamesByAgent: Record<string, string[]> = {
  'claude-code': ['知识库检索', '代码解释器', '图像理解', '文件解析', '多语言翻译', '接口文档生成'],
  'openai-codex': [
    '知识库检索',
    '代码解释器',
    '图像理解',
    '文件解析',
    '多语言翻译',
    '日志异常诊断',
  ],
  'gemini-cli': ['知识库检索', '代码解释器', '图像理解', '文件解析', '多语言翻译'],
  'cursor-agent': ['知识库检索', '代码解释器', '图像理解', '文件解析', '多语言翻译'],
}

const isSkill = (skill: Skill | undefined): skill is Skill => skill !== undefined

const selectedId = ref(cliAgents[0].id)
const selectedAgent = computed(
  () => cliAgents.find((agent) => agent.id === selectedId.value) ?? cliAgents[0],
)

const boundSkills = computed(() => {
  const names = boundSkillNamesByAgent[selectedId.value] ?? []
  return names.map((name) => skills.find((skill) => skill.name === name)).filter(isSkill)
})

type PanelTab = 'skills' | 'mcp'
const activeTab = ref<PanelTab>('skills')

/** 绑定弹窗：skills / MCP 共用一个组件 */
const bindModal = ref<{ kind: PanelTab } | null>(null)
const boundSkillIds = ref<string[]>([])
const boundMcpIds = ref<string[]>([])

const skillItems = computed<BindItem[]>(() =>
  skills.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
    icon: skill.icon,
    iconBg: skill.iconBg,
    iconColor: skill.iconColor,
  })),
)

const mcpItems = computed<BindItem[]>(() =>
  mcpServices.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    icon: service.icon,
    iconBg: service.iconBg,
    iconColor: service.iconColor,
  })),
)

/** 打开绑定弹窗：带入当前已绑定的项 */
const openBind = (kind: PanelTab) => {
  bindModal.value = { kind }
  if (kind === 'skills') {
    boundSkillIds.value = [...(boundSkillNamesByAgent[selectedId.value] ?? [])]
  } else {
    boundMcpIds.value = [...boundMcpIds.value]
  }
}

const onBindConfirm = (ids: string[]) => {
  if (bindModal.value?.kind === 'skills') {
    boundSkillNamesByAgent[selectedId.value] = ids
    message.success(`已绑定 ${ids.length} 个能力`)
  } else {
    boundMcpIds.value = ids
    message.success(`已绑定 ${ids.length} 个 MCP`)
  }
  bindModal.value = null
}

const copyPath = () => {
  void navigator.clipboard?.writeText(selectedAgent.value.path)
  message.success('路径已复制')
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">智能体工作台</h1>
        <p class="page-sub">为本地 CLI agents 绑定能力</p>
      </div>
    </header>

    <div class="split">
      <aside class="list card">
        <header class="list-head">
          <span class="list-title">本地 CLI</span>
          <span class="list-count tnum">{{ cliAgents.length }}</span>
        </header>

        <ul class="list-body">
          <li v-for="agent in cliAgents" :key="agent.id">
            <button
              type="button"
              class="list-item"
              :class="{ active: agent.id === selectedId }"
              @click="selectedId = agent.id"
            >
              <span class="list-icon" :style="{ background: agent.iconBg }" aria-hidden="true">
                <img class="list-icon-img" :src="agent.icon" :alt="agent.name" />
              </span>
              <span class="list-text">
                <span class="list-name">{{ agent.name }}</span>
                <span class="list-meta tnum">{{ agent.skillsCount }} 个能力</span>
              </span>
              <ChevronRight class="list-arrow" :size="13" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </aside>

      <div class="detail card">
        <header class="detail-head">
          <span
            class="detail-icon"
            :style="{ background: selectedAgent.iconBg }"
            aria-hidden="true"
          >
            <img class="detail-icon-img" :src="selectedAgent.icon" :alt="selectedAgent.name" />
          </span>

          <div class="detail-title">
            <div class="detail-name-row">
              <span class="detail-name">{{ selectedAgent.name }}</span>
            </div>
            <code class="detail-path mono">{{ selectedAgent.path }}</code>
          </div>

          <div class="detail-tools">
            <NButton quaternary size="tiny" @click="copyPath">复制路径</NButton>
            <NRadioGroup v-model:value="activeTab" size="small" class="detail-tabs">
              <NRadioButton value="skills">Skills</NRadioButton>
              <NRadioButton value="mcp">MCP</NRadioButton>
            </NRadioGroup>
          </div>
        </header>

        <div v-if="activeTab === 'skills'" class="panel">
          <header class="panel-head">
            <div>
              <span class="panel-title">已绑定能力</span>
              <span class="panel-count tnum">{{ boundSkills.length }}</span>
            </div>
            <NSpace :size="8" align="center">
              <NButton size="small" type="primary" @click="openBind('skills')">
                <template #icon>
                  <NIcon :size="14">
                    <Plus />
                  </NIcon>
                </template>
                绑定能力
              </NButton>
            </NSpace>
          </header>

          <ul class="capability-grid">
            <li v-for="skill in boundSkills" :key="skill.name" class="capability">
              <span
                class="capability-icon"
                :style="{ background: skill.iconBg, color: skill.iconColor }"
                aria-hidden="true"
              >
                <component :is="skill.icon" :size="14" />
              </span>
              <span class="capability-text">
                <span class="capability-name">{{ skill.name }}</span>
                <span class="capability-desc">{{ skill.description }}</span>
              </span>
            </li>
          </ul>
        </div>

        <div v-else class="panel">
          <header class="panel-head">
            <span class="panel-title">已绑定 MCP</span>
            <NButton size="small" type="primary" @click="message.info('绑定 MCP')"
              >绑定 MCP</NButton
            >
          </header>
          <div class="placeholder">
            <p class="placeholder-title">尚未绑定 MCP 服务</p>
            <p class="placeholder-sub">绑定后该 agent 即可调用对应工具</p>
          </div>
        </div>

        <footer class="detail-foot">
          <span class="foot-text">绑定关系保存在本地配置中</span>
          <NTooltip trigger="hover">
            <template #trigger>
              <span class="foot-text foot-muted">{{ selectedAgent.name }}</span>
            </template>
            当前选中的智能体
          </NTooltip>
        </footer>
      </div>
    </div>

    <BindCapabilityModal
      v-if="bindModal"
      :show="bindModal !== null"
      :title="bindModal.kind === 'skills' ? '绑定 skills' : '绑定 MCP'"
      :subtitle="
        bindModal.kind === 'skills'
          ? `为 ${selectedAgent.name} 选择可调用的能力。`
          : `为 ${selectedAgent.name} 选择可用的服务。`
      "
      :search-placeholder="bindModal.kind === 'skills' ? '搜索 skills 名称' : '搜索 MCP 名称'"
      :items="bindModal.kind === 'skills' ? skillItems : mcpItems"
      :selected="bindModal.kind === 'skills' ? boundSkillIds : boundMcpIds"
      :unit="bindModal.kind === 'skills' ? 'skills' : 'MCP'"
      @update:selected="
        (ids: string[]) => {
          if (bindModal?.kind === 'skills') boundSkillIds = ids
          else boundMcpIds = ids
        }
      "
      @close="bindModal = null"
      @confirm="onBindConfirm"
    />
  </section>
</template>

<style scoped>
.page {
  padding: 20px 24px 32px;
}

.page-head {
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.split {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.list {
  overflow: hidden;
}

.list-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--c-border);
}

.list-title {
  font-size: 13px;
  font-weight: 600;
}

.list-count {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-3);
}

.list-body {
  margin: 0;
  padding: 4px;
  list-style: none;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
}

.list-item:hover {
  background: var(--c-surface-sunken);
}

.list-item.active {
  background: #eef2ff;
}

.list-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
}

.list-icon-img {
  width: 15px;
  height: 15px;
  object-fit: contain;
}

.list-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.list-name {
  overflow: hidden;
  font-size: 13px;
  color: var(--c-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-item.active .list-name {
  font-weight: 500;
  color: var(--c-accent);
}

.list-meta {
  font-size: 11px;
  color: var(--c-text-3);
}

.list-arrow {
  flex: none;
  color: var(--c-text-4);
}

.detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border);
}

.detail-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
}

.detail-icon-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.detail-title {
  flex: 1;
  min-width: 0;
}

.detail-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.detail-name {
  font-size: 14px;
  font-weight: 600;
}

.detail-path {
  display: block;
  overflow: hidden;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.detail-tabs {
  flex: none;
}

.panel {
  flex: 1;
  min-height: 320px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
}

.panel-count {
  margin-left: 6px;
  font-size: 12px;
  color: var(--c-text-3);
}

.capability-grid {
  display: grid;
  /* 一行一个 */
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  padding: 0 16px 16px;
  list-style: none;
}

.capability {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.capability-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
}

.capability-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.capability-name {
  font-size: 13px;
  font-weight: 500;
}

.capability-desc {
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder {
  padding: 48px 16px;
  text-align: center;
}

.placeholder-title {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.placeholder-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.detail-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.foot-text {
  font-size: 12px;
  color: var(--c-text-3);
}

.foot-muted {
  color: var(--c-text-4);
}

@media (max-width: 1080px) {
  .split {
    grid-template-columns: 1fr;
  }
}
</style>
