<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NDrawer,
  NDrawerContent,
  NIcon,
  NInputNumber,
  NSpace,
  NTag,
  useMessage,
} from 'naive-ui'
import { ChevronRight, ShieldCheck } from 'lucide-vue-next'
import {
  exposedToolName,
  parseToolKey,
  toolKey,
  type McpExposure,
  type McpServerDef,
  type McpUpstreamStatus,
} from '@remote/agent-compose-mcp/types'

const props = defineProps<{
  show: boolean
  servers: McpServerDef[]
  upstreams: McpUpstreamStatus[]
  exposure: McpExposure
}>()

const emit = defineEmits<{
  close: []
  save: [exposure: McpExposure]
}>()

const message = useMessage()

const selectedKeys = ref<string[]>([])
/** server 的排序提示（兼作裁剪顺序）；实际暴露哪些 server 由选中的工具推导 */
const serverOrder = ref<string[]>([])
const maxTools = ref(150)
/** 展开的 server 分组 */
const expandedGroups = ref<string[]>([])

watch(
  () => [props.show, props.exposure] as const,
  ([show]) => {
    if (!show) return
    selectedKeys.value = [...props.exposure.toolKeys]
    serverOrder.value = [...props.exposure.serverIds]
    maxTools.value = props.exposure.maxTools
    // 有已选工具的分组默认展开，其余收起
    expandedGroups.value = props.servers
      .filter((server) => {
        const upstream = props.upstreams.find((item) => item.serverId === server.id)
        return (upstream?.tools ?? []).some((tool) =>
          props.exposure.toolKeys.includes(toolKey(server.id, tool.name)),
        )
      })
      .map((server) => server.id)
  },
  { immediate: true },
)

/** 按 server 分组的工具清单 */
const groups = computed(() =>
  props.servers
    .filter((server) => server.enabled)
    .map((server) => {
      const upstream = props.upstreams.find((item) => item.serverId === server.id)
      return {
        server,
        tools: upstream?.tools ?? [],
        state: upstream?.state ?? 'disconnected',
      }
    }),
)

const selectedCount = computed(() => selectedKeys.value.length)
const overLimit = computed(() => selectedCount.value > maxTools.value)

const isToolSelected = (serverId: string, toolName: string): boolean =>
  selectedKeys.value.includes(toolKey(serverId, toolName))

const setTool = (serverId: string, toolName: string, checked: boolean): void => {
  const key = toolKey(serverId, toolName)
  if (checked) {
    if (!selectedKeys.value.includes(key)) {
      selectedKeys.value = [...selectedKeys.value, key]
    }
    if (!serverOrder.value.includes(serverId)) {
      serverOrder.value = [...serverOrder.value, serverId]
    }
    return
  }
  selectedKeys.value = selectedKeys.value.filter((item) => item !== key)
}

/**
 * 参与暴露的 server = 至少选了一个工具的 server。
 *
 * 后端 `registry.build()` 是按 `serverIds` 遍历再过滤 `toolKeys` 的，
 * 所以 serverIds 必须由工具选择推导，否则单独勾的工具会静默丢失。
 */
const exposedServerIds = computed(() => {
  const ids = new Set<string>()
  for (const key of selectedKeys.value) {
    const parsed = parseToolKey(key)
    if (parsed) ids.add(parsed.serverId)
  }
  const rank = new Map(serverOrder.value.map((id, index) => [id, index]))
  return [...ids].sort(
    (a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
})

/** 分组的勾选状态：全选 / 部分 / 未选 */
const groupStat = (group: (typeof groups.value)[number]) => {
  const total = group.tools.length
  const selected = group.tools.filter((tool) => isToolSelected(group.server.id, tool.name)).length
  return {
    total,
    selected,
    checked: total > 0 && selected === total,
    indeterminate: selected > 0 && selected < total,
  }
}

const toggleServer = (serverId: string, tools: { name: string }[], checked: boolean): void => {
  for (const tool of tools) {
    setTool(serverId, tool.name, checked)
  }
}

/** 半选状态下点击一律转为全选 */
const onToggleGroup = (group: (typeof groups.value)[number], checked: boolean): void => {
  const stat = groupStat(group)
  toggleServer(group.server.id, group.tools, stat.indeterminate ? true : checked)
}

const isExpanded = (serverId: string): boolean => expandedGroups.value.includes(serverId)

const toggleGroup = (serverId: string): void => {
  expandedGroups.value = isExpanded(serverId)
    ? expandedGroups.value.filter((id) => id !== serverId)
    : [...expandedGroups.value, serverId]
}

/** 按 serverIds 顺序排列工具白名单，超出上限的部分裁剪掉 */
const orderedKeys = (): string[] => {
  const order = new Map(exposedServerIds.value.map((id, index) => [id, index]))
  const rank = (key: string): number => {
    const parsed = parseToolKey(key)
    if (!parsed) return Number.MAX_SAFE_INTEGER
    return order.get(parsed.serverId) ?? Number.MAX_SAFE_INTEGER
  }
  return [...selectedKeys.value].sort((a, b) => rank(a) - rank(b))
}

/** 工具数量上限：忽略清空输入（null） */
const onMaxToolsUpdate = (value: number | null): void => {
  if (value !== null) maxTools.value = value
}

const save = (): void => {
  const ordered = orderedKeys()
  const trimmed = ordered.slice(0, Math.max(0, maxTools.value))
  if (trimmed.length < ordered.length) {
    message.warning(`超出上限，已按 server 顺序保留前 ${trimmed.length} 个工具`)
  }
  emit('save', {
    serverIds: [...exposedServerIds.value],
    toolKeys: trimmed,
    maxTools: maxTools.value,
  })
}
</script>

<template>
  <NDrawer
    :show="show"
    :width="460"
    placement="right"
    :trap-focus="false"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <NDrawerContent closable :native-scrollbar="false" body-content-style="padding: 0">
      <template #header>
        <span class="drawer-title">对外暴露的工具</span>
      </template>

      <div class="body">
        <div class="summary" :class="{ over: overLimit }">
          <div class="summary-left">
            <NIcon :size="14">
              <ShieldCheck />
            </NIcon>
            <span class="summary-text">
              已选 <strong class="tnum">{{ selectedCount }}</strong> / 上限
              <strong class="tnum">{{ maxTools }}</strong>
            </span>
          </div>
          <div class="summary-right">
            <span class="summary-label">上限</span>
            <NInputNumber
              :value="maxTools"
              size="tiny"
              :min="1"
              :max="999"
              @update:value="onMaxToolsUpdate"
            />
          </div>
        </div>

        <p v-if="overLimit" class="over-hint">
          已选工具超过上限 {{ selectedCount - maxTools }} 个，保存时会按 server 顺序裁剪。
        </p>

        <section v-for="group in groups" :key="group.server.id" class="group">
          <header class="group-head">
            <div class="group-left">
              <NCheckbox
                :checked="groupStat(group).checked"
                :indeterminate="groupStat(group).indeterminate"
                :disabled="!groupStat(group).total"
                @update:checked="(checked: boolean) => onToggleGroup(group, checked)"
              />
              <button
                type="button"
                class="group-toggle"
                :aria-expanded="isExpanded(group.server.id)"
                @click="toggleGroup(group.server.id)"
              >
                <NIcon
                  :size="13"
                  class="toggle-caret"
                  :class="{ open: isExpanded(group.server.id) }"
                >
                  <ChevronRight />
                </NIcon>
                <span class="group-name">{{ group.server.name }}</span>
              </button>
            </div>
            <div class="group-meta">
              <NTag size="small" :bordered="false">{{ group.server.transport }}</NTag>
              <span class="tnum group-count">
                {{ groupStat(group).selected }} / {{ groupStat(group).total }}
              </span>
            </div>
          </header>

          <ul v-if="groupStat(group).total && isExpanded(group.server.id)" class="tool-list">
            <li v-for="tool in group.tools" :key="tool.name" class="tool">
              <NCheckbox
                :checked="isToolSelected(group.server.id, tool.name)"
                @update:checked="(checked: boolean) => setTool(group.server.id, tool.name, checked)"
              >
                <span class="tool-name">{{ tool.name }}</span>
              </NCheckbox>
              <span class="tool-desc">{{ tool.description ?? '无描述' }}</span>
              <code class="tool-exposed mono">
                {{ exposedToolName(group.server.id, tool.name) }}
              </code>
            </li>
          </ul>

          <p v-else-if="!groupStat(group).total" class="tool-empty">
            该 server 暂未上报工具，先在列表里测试连接。
          </p>
        </section>

        <p v-if="!groups.length" class="tool-empty">还没有启用的上游 MCP server。</p>
      </div>

      <template #footer>
        <NSpace justify="end">
          <NButton size="small" @click="emit('close')">取消</NButton>
          <NButton size="small" type="primary" @click="save">保存</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.drawer-title {
  font-size: 12px;
  color: var(--c-text-3);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 20px;
}

.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.summary.over {
  border-color: var(--c-warning);
}

.summary-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--c-text-2);
}

.summary.over .summary-left {
  color: var(--c-warning);
}

.summary-text {
  font-size: 12px;
}

.summary-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-label {
  font-size: 11px;
  color: var(--c-text-3);
}

.over-hint {
  margin: -8px 0 0;
  font-size: 11px;
  color: var(--c-warning);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.group-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
  cursor: pointer;
}

.group-toggle:hover {
  background: var(--c-surface-sunken);
}

.group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-caret {
  flex: none;
  color: var(--c-text-3);
  transition: transform 0.15s ease;
}

.toggle-caret.open {
  transform: rotate(90deg);
}

.group-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-count {
  font-size: 11px;
  color: var(--c-text-3);
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tool {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  align-items: center;
  gap: 4px 12px;
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.tool-name {
  font-size: 13px;
}

.tool-desc {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-exposed {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--c-text-4);
}

.tool-empty {
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  color: var(--c-text-3);
}
</style>
