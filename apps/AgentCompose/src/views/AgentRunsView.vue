<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NIcon, NInput, NModal, NSpace, useMessage } from 'naive-ui'
import { Plus, Search } from 'lucide-vue-next'
import { agentIcons } from '@/data/agentIcons'
import { useCreatedAgents, type CreatedAgent } from '@/data/createdAgents'
import AgentRunMenu, { type AgentRunMenuAction } from '@/components/AgentRunMenu.vue'

const emit = defineEmits<{ create: []; edit: [id: string] }>()

const message = useMessage()
const query = ref('')

/** 已创建的智能体（从磁盘读回；「新建智能体」里建的就是它们） */
const { createdAgents, remove } = useCreatedAgents()

/** 智能体跑在 Pi 上，所以图标就用 Pi 的 */
const iconOf = (): string => agentIcons.pi

/** 创建时间 → 「刚刚 / N 分钟前 / …」 */
const sinceText = (timestamp: number): string => {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  return `${Math.floor(diff / day)} 天前`
}

const visibleRuns = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return createdAgents.value
  return createdAgents.value.filter((run) =>
    `${run.name}${run.description}${run.skills.join(' ')}`.toLowerCase().includes(keyword),
  )
})

/** 待删除的实例 */
const deleteTarget = ref<CreatedAgent | null>(null)

const onRowAction = (action: AgentRunMenuAction, agentName: string) => {
  if (action === 'copy') {
    void navigator.clipboard?.writeText(agentName)
    message.success('已复制名称')
    return
  }
  if (action === 'copyCommand') {
    // 终端里敲这条命令就能按这个智能体启动 Pi
    void navigator.clipboard?.writeText(`agentspace run ${agentName}`)
    message.success('已复制启动命令')
    return
  }
  deleteTarget.value = createdAgents.value.find((run) => run.name === agentName) ?? null
}

const confirmDelete = async () => {
  const target = deleteTarget.value
  if (!target) return
  try {
    await remove(target.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    return
  }
  deleteTarget.value = null
  message.success(`已删除：${target.name}`)
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">智能体</h1>
        <p class="page-sub">{{ createdAgents.length }} 个智能体，可绑定能力后交给智能体执行</p>
      </div>
      <NSpace :size="8">
        <NInput
          v-model:value="query"
          class="search"
          size="small"
          clearable
          placeholder="搜索名称或能力"
        >
          <template #prefix>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
        </NInput>
        <NButton size="small" type="primary" @click="emit('create')">
          <template #icon>
            <NIcon :size="14">
              <Plus />
            </NIcon>
          </template>
          新建智能体
        </NButton>
      </NSpace>
    </header>

    <div class="card">
      <!-- 表头独立于表格体，固定不滚动 -->
      <div class="table-head table-grid" role="row">
        <span role="columnheader">名称</span>
        <span role="columnheader">能力</span>
        <span role="columnheader">MCP</span>
        <span role="columnheader">版本</span>
        <span role="columnheader">创建于</span>
        <span role="columnheader"><span class="sr-only">操作</span></span>
      </div>

      <!-- 只有表格体滚动 -->
      <div class="table-scroll">
        <div
          v-for="run in visibleRuns"
          :key="run.id"
          class="run-row table-grid"
          role="row"
          tabindex="0"
          @click="emit('edit', run.id)"
          @keydown.enter="emit('edit', run.id)"
        >
          <div class="cell-name" role="cell">
            <span class="cell-icon" style="background: #f5f5f3" aria-hidden="true">
              <img class="cell-icon-img" :src="iconOf()" :alt="run.name" />
            </span>
            <span class="cell-text">
              <span class="cell-title">{{ run.name }}</span>
              <span v-if="run.description" class="cell-sub">{{ run.description }}</span>
            </span>
          </div>

          <div class="cell-muted" role="cell">{{ run.skills.length }} 个 skill</div>

          <div class="cell-muted" role="cell">{{ run.mcpServers.length }} 个 MCP</div>

          <div class="cell-muted tnum" role="cell">v{{ run.version }}</div>

          <div class="cell-muted" role="cell">{{ sinceText(run.createdAt) }}</div>

          <div class="cell-actions" role="cell" @click.stop>
            <AgentRunMenu
              :agent-name="run.name"
              @action="(action: AgentRunMenuAction, name: string) => onRowAction(action, name)"
            />
          </div>
        </div>

        <p v-if="!visibleRuns.length" class="empty">
          {{
            createdAgents.length
              ? '没有匹配的智能体'
              : '还没有智能体 —— 点右上角「新建智能体」建一个'
          }}
        </p>
      </div>
    </div>

    <NModal
      :show="deleteTarget !== null"
      preset="card"
      style="width: 360px"
      :bordered="false"
      title="删除智能体"
      @update:show="(show: boolean) => !show && (deleteTarget = null)"
    >
      <p class="confirm-text">
        确定要删除 <strong>{{ deleteTarget?.name }}</strong> 吗？该操作不可撤销。
      </p>
      <div class="confirm-actions">
        <NButton size="small" @click="deleteTarget = null">取消</NButton>
        <NButton size="small" type="error" @click="confirmDelete">删除</NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.page {
  /* 整页不滚动：页面头部与表头固定，只有表格体滚动 */
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  padding: 20px 24px 24px;
  overflow: hidden;
}

.page-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.search {
  width: 240px;
}

.card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

/* 表头与数据行共用同一套列宽定义，保证纵向对齐 */
.table-grid {
  display: grid;
  grid-template-columns: 30fr 11fr 22fr 10fr 15fr 8fr;
  align-items: center;
  column-gap: 12px;
  padding: 0 20px;
}

.table-head {
  flex: none;
  height: 39px;
  background: var(--c-surface-sunken);
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text-3);
  font-size: 13px;
  font-weight: 500;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.run-row {
  min-height: 51px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--c-border);
  transition: background 0.15s;
  cursor: pointer;
}

.run-row:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

.run-row:hover {
  background: var(--c-surface-sunken);
}

.run-row.idle {
  background: var(--c-surface-sunken);
}

.cell-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 名称与描述上下排列 */
.cell-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cell-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}

.cell-icon-img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.cell-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-sub {
  overflow: hidden;
  max-width: 320px;
  font-size: 11px;
  color: var(--c-text-4);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-muted {
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.cell-actions {
  display: flex;
  justify-content: flex-end;
}

.empty {
  margin: 0;
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-3);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
