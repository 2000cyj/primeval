<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, useMessage } from 'naive-ui'
import { Check, Search, Server, X } from 'lucide-vue-next'
import { listServers } from '@/api/mcp'
import { mcpServerRef } from '@/data/agentRefs'
import type { McpServerDef } from '@remote/agent-compose-mcp/types'

/**
 * 新建智能体时的 MCP server 选择弹窗。
 *
 * 交互与 skill 选择弹窗一致（抄它的），只是选的是 MCP server。
 * 数据来自 MCP 页的真实数据（上游 server 列表），不是演示数据。
 */
const props = defineProps<{
  show: boolean
  /** 已选中的 MCP server（相对路径引用，如 `mcp/servers.json#filesystem`） */
  selected: string[]
}>()

const emit = defineEmits<{
  close: []
  'update:selected': [refs: string[]]
}>()

const message = useMessage()
const keyword = ref('')
/** 上游 server 列表（MCP 页的数据） */
const servers = ref<McpServerDef[]>([])
const loading = ref(false)

const load = async () => {
  loading.value = true
  try {
    servers.value = await listServers()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    servers.value = []
  } finally {
    loading.value = false
  }
}

const visibleServers = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return servers.value
  return servers.value.filter((server) =>
    `${server.name}${server.id}${describe(server)}`.toLowerCase().includes(word),
  )
})

/** 一行说明：stdio 看命令，http 看地址 */
const describe = (server: McpServerDef): string => {
  if (server.transport === 'http') return server.url ?? ''
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
}

const isSelected = (id: string) => props.selected.includes(mcpServerRef(id))

const toggle = (id: string) => {
  const ref = mcpServerRef(id)
  const next = isSelected(id)
    ? props.selected.filter((item) => item !== ref)
    : [...props.selected, ref]
  emit('update:selected', next)
}

const selectAll = () => {
  emit(
    'update:selected',
    visibleServers.value.map((server) => mcpServerRef(server.id)),
  )
}

const clearAll = () => {
  emit('update:selected', [])
}

// 每次打开时清空搜索并重新拉一次
watch(
  () => props.show,
  (show) => {
    if (show) {
      keyword.value = ''
      void load()
    }
  },
)
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="mcp-picker-modal"
    style="width: 540px"
    :bordered="false"
    :closable="false"
    :mask-closable="true"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">选择 MCP</h2>
        <p class="modal-sub">为这个智能体勾选它可以连的上游 MCP server。</p>
      </div>
      <NButton quaternary circle size="tiny" aria-label="关闭" @click="emit('close')">
        <template #icon>
          <NIcon :size="16">
            <X />
          </NIcon>
        </template>
      </NButton>
    </header>

    <div class="search-row">
      <NInput v-model:value="keyword" size="small" placeholder="搜索 MCP 名称">
        <template #prefix>
          <NIcon :size="15">
            <Search />
          </NIcon>
        </template>
      </NInput>
      <span class="selected-count">已选择 {{ props.selected.length }}</span>
    </div>

    <ul class="mcp-list">
      <li v-for="server in visibleServers" :key="server.id">
        <button
          type="button"
          class="mcp-option"
          :class="{ checked: isSelected(server.id) }"
          :aria-pressed="isSelected(server.id)"
          @click="toggle(server.id)"
        >
          <span class="mcp-icon">
            <Server :size="17" />
          </span>
          <span class="mcp-text">
            <span class="mcp-name">
              {{ server.name }}
              <span class="mcp-transport">{{ server.transport }}</span>
            </span>
            <span class="mcp-desc">{{ describe(server) }}</span>
          </span>
          <span class="mcp-check" :class="{ on: isSelected(server.id) }">
            <Check v-if="isSelected(server.id)" :size="13" />
          </span>
        </button>
      </li>
      <li v-if="loading" class="mcp-empty">正在读取 MCP server…</li>
      <li v-else-if="!visibleServers.length" class="mcp-empty">
        {{ servers.length ? '没有匹配的结果' : '还没有上游 MCP server —— 先去 MCP 页添加' }}
      </li>
    </ul>

    <footer class="modal-foot">
      <div class="foot-links">
        <button type="button" class="link" @click="selectAll">全选</button>
        <button type="button" class="link" @click="clearAll">清空</button>
      </div>
      <div class="foot-actions">
        <NButton size="small" @click="emit('close')">取消</NButton>
        <NButton size="small" type="primary" @click="emit('close')">确定</NButton>
      </div>
    </footer>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--c-border);
}

.modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-strong);
}

.modal-sub {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0 12px;
}

.selected-count {
  flex: none;
  font-size: 11px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.mcp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  margin: 0;
  padding: 0 2px 0 0;
  overflow-y: auto;
  list-style: none;
}

.mcp-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  text-align: left;
}

.mcp-option:hover {
  border-color: var(--c-border-strong);
}

.mcp-option.checked {
  background: #f5f5f3;
  border-color: #dcdcd6;
}

.mcp-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--radius);
  background: var(--c-surface-sunken);
  color: var(--c-text-3);
}

.mcp-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mcp-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.mcp-transport {
  padding: 0 5px;
  border-radius: 3px;
  background: var(--c-surface-sunken);
  font-family: var(--c-font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 400;
  color: var(--c-text-3);
}

.mcp-desc {
  overflow: hidden;
  font-size: 10px;
  line-height: 1.5;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 19px;
  height: 19px;
  border: 1px solid var(--c-text-disabled);
  border-radius: 5px;
  color: #fff;
}

.mcp-check.on {
  background: var(--c-accent);
  border-color: var(--c-accent);
}

.mcp-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--c-border);
}

.foot-links {
  display: flex;
  gap: 12px;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  color: var(--c-text-3);
}

.link:hover {
  color: var(--c-accent);
}

.foot-actions {
  display: flex;
  gap: 8px;
}
</style>
