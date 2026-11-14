<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NIcon, NInput, NModal, NSpace, NSpin, NTag } from 'naive-ui'
import { CircleAlert, Download, Search } from 'lucide-vue-next'
import type { McpRegistryEntry, McpServerDef } from '@remote/agent-compose-mcp/types'
import { registryServerDef, searchRegistry } from '@/api/mcp'

/**
 * 官方 MCP 目录搜索弹窗。
 *
 * 目录条目由 sidecar 自动翻译成上游定义（`entry.def`），前端只负责展示与回传，
 * 不自己拼 command / args / url。
 */
const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  /**
   * 添加一个目录里的 server。
   *
   * `registryName` 一并带出去（如 `io.github.owner/repo`）——
   * 数据管理导出时靠它判「这个 server 是目录装的还是手动填的」：
   * 目录装的导出时只记名字，导入方自己去目录里找；手动填的导出完整定义。
   */
  add: [def: McpServerDef, registryName: string]
}>()

/** 目录条目的一行展示模型 */
type RegistryRow = {
  key: string
  title: string
  source: string
  version: string
  official: boolean
  description: string
  /** stdio / http / 未知 */
  transport: string
  /** 可一键添加时非空 */
  def: McpServerDef | null
}

const query = ref('')
const entries = ref<McpRegistryEntry[]>([])
const nextCursor = ref<string | undefined>(undefined)
const source = ref('')
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')

const rows = computed<RegistryRow[]>(() =>
  entries.value.map((entry) => {
    const def = registryServerDef(entry)
    const transport =
      def?.transport ?? (entry.packages?.length ? 'stdio' : entry.remotes?.length ? 'http' : '未知')
    return {
      key: entry.name,
      title: entry.title || entry.name,
      source: entry.name,
      version: entry.version ?? '',
      official: entry.official === true,
      description: entry.description ?? '',
      transport,
      def,
    }
  }),
)

const runSearch = async (): Promise<void> => {
  loading.value = true
  errorText.value = ''
  try {
    const result = await searchRegistry(query.value.trim())
    entries.value = result.entries
    nextCursor.value = result.nextCursor
    source.value = result.source
  } catch (error) {
    entries.value = []
    nextCursor.value = undefined
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

const loadMore = async (): Promise<void> => {
  const cursor = nextCursor.value
  if (!cursor) return
  loadingMore.value = true
  errorText.value = ''
  try {
    const result = await searchRegistry(query.value.trim(), cursor)
    entries.value = [...entries.value, ...result.entries]
    nextCursor.value = result.nextCursor
    source.value = result.source
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingMore.value = false
  }
}

// 打开时拉一次目录（关键词为空即浏览全部），关闭时保留上次搜索词便于继续找
watch(
  () => props.show,
  (show) => {
    if (!show) return
    entries.value = []
    nextCursor.value = undefined
    errorText.value = ''
    void runSearch()
  },
  { immediate: true },
)

const onAdd = (row: RegistryRow): void => {
  if (!row.def) return
  emit('add', row.def, row.source)
  emit('close')
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="registry-modal"
    style="width: 640px"
    :bordered="false"
    title="从 MCP 目录添加"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <div class="search-row">
      <NInput
        v-model:value="query"
        size="small"
        clearable
        placeholder="搜索 MCP 目录，如 github / filesystem"
        @keydown.enter="runSearch"
      >
        <template #prefix>
          <NIcon :size="15">
            <Search />
          </NIcon>
        </template>
      </NInput>
      <NButton size="small" type="primary" :loading="loading" @click="runSearch">搜索</NButton>
    </div>
    <p class="search-hint">
      关键词留空可直接浏览目录全部条目 · 来源：{{ source || '官方 MCP 目录' }}
    </p>

    <div v-if="loading && !entries.length" class="state-box">
      <NSpin size="small" />
      <span class="state-text">正在搜索官方 MCP 目录…</span>
    </div>

    <div v-if="errorText" class="state-box error">
      <NIcon :size="14">
        <CircleAlert />
      </NIcon>
      <span class="state-text">{{ errorText }}</span>
      <NButton size="tiny" @click="runSearch">重试</NButton>
    </div>

    <div v-if="!loading && !errorText && !entries.length" class="state-box">
      <NEmpty size="small" description="没有找到匹配的 server，换个关键词试试" />
    </div>

    <ul v-if="entries.length" class="entry-list">
      <li v-for="row in rows" :key="row.key" class="entry">
        <div class="entry-main">
          <div class="entry-title-row">
            <span class="entry-title">{{ row.title }}</span>
            <NTag size="small" :bordered="false">{{ row.transport }}</NTag>
            <NTag v-if="row.official" size="small" :bordered="false">官方</NTag>
          </div>
          <span class="entry-source mono">
            {{ row.source }}<template v-if="row.version"> · v{{ row.version }}</template>
          </span>
          <p v-if="row.description" class="entry-desc">{{ row.description }}</p>
          <p v-else class="entry-desc">该条目没有描述信息</p>
        </div>
        <div class="entry-actions">
          <NButton size="tiny" type="primary" :disabled="!row.def" @click="onAdd(row)">
            <template #icon>
              <NIcon :size="13">
                <Download />
              </NIcon>
            </template>
            添加
          </NButton>
          <span v-if="!row.def" class="entry-hint">没有可用的启动方式，无法直接添加</span>
        </div>
      </li>
    </ul>

    <template #footer>
      <NSpace justify="space-between" align="center">
        <NButton v-if="nextCursor" size="small" :loading="loadingMore" @click="loadMore">
          加载更多
        </NButton>
        <span v-else class="foot-note">共 {{ entries.length }} 条</span>
        <NButton size="small" @click="emit('close')">关闭</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.state-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 96px;
  padding: 16px;
  color: var(--c-text-3);
  font-size: 12px;
}

.state-box.error {
  justify-content: flex-start;
  color: var(--c-danger);
}

.state-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  margin: 12px 0 0;
  padding: 0 2px 0 0;
  overflow-y: auto;
  list-style: none;
}

.entry {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
}

.entry:hover {
  border-color: var(--c-border-strong);
}

.entry-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.entry-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.entry-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-source {
  overflow: hidden;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.entry-actions {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.entry-hint {
  max-width: 150px;
  font-size: 10px;
  line-height: 1.4;
  color: var(--c-text-3);
  text-align: right;
}

.foot-note {
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
