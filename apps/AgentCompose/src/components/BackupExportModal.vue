<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NModal, NSpin, useMessage } from 'naive-ui'
import { Check, ChevronDown, ChevronRight, Download } from 'lucide-vue-next'
import {
  exportBackup,
  listBackupInventory,
  type BackupExtension,
  type BackupInventory,
} from '@/api/backup'

/**
 * 导出弹窗：勾选要带走的智能体 / Skills / MCP server / Pi 扩展，打成一个 zip。
 *
 * 勾了智能体，它引用的 skill、MCP server、扩展会自动一起勾上 ——
 * 智能体本身只存路径引用，不把被引用的东西带上，导过去就是个空壳。
 * 用户手动取消掉某一个也尊重 —— 勾选状态分成「手动勾的」和「手动取消的」两套，
 * 派生的那部分只负责补齐缺口，不会把用户的选择顶回来。
 */
const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const message = useMessage()

/** 本机可导出的数据 */
const inventory = ref<BackupInventory>({
  agents: [],
  skills: [],
  mcpServers: [],
  extensions: [],
})
/** 正在读库存 */
const loading = ref(false)
/** 正在打包 */
const exporting = ref(false)

// ── 勾选状态 ──
//
// 三套状态分开记：
// - manual：用户自己点选的
// - off：用户明确取消掉的（优先级最高，自动带出的也不会顶回来）
// - auto：由「勾中的智能体」派生出来的（不落盘，每次算出来）

/** 勾中的智能体 id */
const manualAgents = ref<string[]>([])
/** 勾中的 skill 名 */
const manualSkills = ref<string[]>([])
/** 勾中的 MCP server id */
const manualMcp = ref<string[]>([])
/** 勾中的扩展名 */
const manualExtensions = ref<string[]>([])
/** 被取消勾选的 skill 名 */
const offSkills = ref<string[]>([])
/** 被取消勾选的 MCP server id */
const offMcp = ref<string[]>([])
/** 被取消勾选的扩展名 */
const offExtensions = ref<string[]>([])

/** 折叠起来的分组 */
const collapsed = ref<Record<string, boolean>>({
  agent: false,
  skill: false,
  mcpServer: false,
  extension: false,
})

/**
 * 智能体里的引用是相对路径（`skills/vue` / `extensions/npm/context-mode`），
 * 而库存里的键是目录名（`vue` / `context-mode`）—— 取最后一段对得上。
 */
const referencedKey = (reference: string): string => {
  const parts = reference
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts.length ? (parts[parts.length - 1] as string) : reference.trim()
}

/**
 * 智能体里 MCP server 的引用是 `mcp/servers.json#<id>`，
 * 库存里的键是纯 id —— 要把 `#` 后面的那截取出来。
 *
 * 不取的话自动带出就匹配不上：引用是 `mcp/servers.json#idea`，
 * 库存里是 `idea`，两个字符串不相等。
 */
const referencedMcpId = (reference: string): string => {
  const hash = reference.lastIndexOf('#')
  return hash >= 0 ? reference.slice(hash + 1).trim() : reference.trim()
}

/** 勾中的智能体 */
const selectedAgents = computed(() =>
  inventory.value.agents.filter((agent) => manualAgents.value.includes(agent.id)),
)

/** 被勾中的智能体带出来的 skill 名 */
const autoSkills = computed(() => {
  const keys = new Set<string>()
  for (const agent of selectedAgents.value) {
    for (const reference of agent.skills) keys.add(referencedKey(reference))
  }
  return keys
})

/** 被勾中的智能体带出来的 MCP server id */
const autoMcp = computed(() => {
  const keys = new Set<string>()
  for (const agent of selectedAgents.value) {
    for (const reference of agent.mcpServers) keys.add(referencedMcpId(reference))
  }
  return keys
})

/** 被勾中的智能体带出来的扩展名 */
const autoExtensions = computed(() => {
  const keys = new Set<string>()
  for (const agent of selectedAgents.value) {
    for (const reference of agent.extensions) keys.add(referencedKey(reference))
  }
  return keys
})

/** 勾中的 skill 名（只留库存里有的，智能体引用悬空的忽略掉） */
const checkedSkills = computed(() => {
  const known = new Set(inventory.value.skills.map((skill) => skill.name))
  const picked = new Set(manualSkills.value)
  for (const name of autoSkills.value) picked.add(name)
  return [...picked].filter((name) => known.has(name) && !offSkills.value.includes(name))
})

/** 勾中的 MCP server id */
const checkedMcp = computed(() => {
  const known = new Set(inventory.value.mcpServers.map((server) => server.id))
  const picked = new Set(manualMcp.value)
  for (const id of autoMcp.value) picked.add(id)
  return [...picked].filter((id) => known.has(id) && !offMcp.value.includes(id))
})

/** 勾中的扩展名 */
const checkedExtensions = computed(() => {
  const known = new Set(inventory.value.extensions.map((extension) => extension.name))
  const picked = new Set(manualExtensions.value)
  for (const name of autoExtensions.value) picked.add(name)
  return [...picked].filter((name) => known.has(name) && !offExtensions.value.includes(name))
})

/** 一行勾选项。 */
interface ExportRow {
  /** 勾选用的键 */
  key: string
  /** 展示名 */
  label: string
  /** 副标题：来源 / 描述 */
  hint: string
  /** 是不是「随智能体带出」 */
  pulled: boolean
}

/** 智能体列表 */
const agentRows = computed<ExportRow[]>(() =>
  inventory.value.agents.map((agent) => ({
    key: agent.id,
    label: agent.name,
    hint: agent.description || '没有描述',
    pulled: false,
  })),
)

/** skill 列表 */
const skillRows = computed<ExportRow[]>(() =>
  inventory.value.skills.map((skill) => ({
    key: skill.name,
    label: skill.name,
    hint: skill.sourceLabel
      ? `远程 · ${skill.sourceLabel}`
      : `本地 · ${skill.description || '手写'}`,
    pulled: autoSkills.value.has(skill.name),
  })),
)

/** MCP server 列表 */
const mcpRows = computed<ExportRow[]>(() =>
  inventory.value.mcpServers.map((server) => ({
    key: server.id,
    label: server.name,
    hint: server.sourceLabel ? `远程 · ${server.sourceLabel}` : '本地 · 手动配置',
    pulled: autoMcp.value.has(server.id),
  })),
)

/**
 * 扩展的副标题。
 *
 * 后端给自定义扩展的 source 是「自定义」而不是 custom，两种写法都认。
 */
const extensionHint = (extension: BackupExtension): string => {
  if (extension.sourceLabel) return `${extension.source} · ${extension.sourceLabel}`
  if (extension.source === 'npm') return 'npm 包'
  if (extension.source === 'custom' || extension.source === '自定义') return '自定义目录'
  return extension.source
}

/** 扩展列表 */
const extensionRows = computed<ExportRow[]>(() =>
  inventory.value.extensions.map((extension) => ({
    key: extension.name,
    label: extension.name,
    hint: extensionHint(extension),
    pulled: autoExtensions.value.has(extension.name),
  })),
)

/** 一共勾了多少条 */
const totalChecked = computed(
  () =>
    manualAgents.value.length +
    checkedSkills.value.length +
    checkedMcp.value.length +
    checkedExtensions.value.length,
)

/** 勾选 / 取消一个条目。 */
const toggle = (group: 'skill' | 'mcpServer' | 'extension', key: string): void => {
  if (group === 'skill') {
    if (checkedSkills.value.includes(key)) {
      manualSkills.value = manualSkills.value.filter((name) => name !== key)
      offSkills.value = [...offSkills.value, key]
    } else {
      manualSkills.value = [...manualSkills.value, key]
      offSkills.value = offSkills.value.filter((name) => name !== key)
    }
    return
  }
  if (group === 'mcpServer') {
    if (checkedMcp.value.includes(key)) {
      manualMcp.value = manualMcp.value.filter((id) => id !== key)
      offMcp.value = [...offMcp.value, key]
    } else {
      manualMcp.value = [...manualMcp.value, key]
      offMcp.value = offMcp.value.filter((id) => id !== key)
    }
    return
  }
  if (checkedExtensions.value.includes(key)) {
    manualExtensions.value = manualExtensions.value.filter((name) => name !== key)
    offExtensions.value = [...offExtensions.value, key]
  } else {
    manualExtensions.value = [...manualExtensions.value, key]
    offExtensions.value = offExtensions.value.filter((name) => name !== key)
  }
}

/** 勾选 / 取消一个智能体 —— 它带出来的东西会跟着变。 */
const toggleAgent = (id: string): void => {
  manualAgents.value = manualAgents.value.includes(id)
    ? manualAgents.value.filter((agentId) => agentId !== id)
    : [...manualAgents.value, id]
}

/** 分组内某个键当前是不是勾着的。 */
const isChecked = (group: 'agent' | 'skill' | 'mcpServer' | 'extension', key: string): boolean => {
  if (group === 'agent') return manualAgents.value.includes(key)
  if (group === 'skill') return checkedSkills.value.includes(key)
  if (group === 'mcpServer') return checkedMcp.value.includes(key)
  return checkedExtensions.value.includes(key)
}

/** 全选 / 反选某个分组。 */
const bulk = (group: 'agent' | 'skill' | 'mcpServer' | 'extension', invert: boolean): void => {
  const keys =
    group === 'agent'
      ? inventory.value.agents.map((agent) => agent.id)
      : group === 'skill'
        ? inventory.value.skills.map((skill) => skill.name)
        : group === 'mcpServer'
          ? inventory.value.mcpServers.map((server) => server.id)
          : inventory.value.extensions.map((extension) => extension.name)

  if (group === 'agent') {
    manualAgents.value = invert ? keys.filter((id) => !manualAgents.value.includes(id)) : [...keys]
    return
  }

  if (group === 'skill') {
    if (invert) {
      manualSkills.value = keys.filter((name) => !checkedSkills.value.includes(name))
      offSkills.value = keys.filter((name) => checkedSkills.value.includes(name))
    } else {
      manualSkills.value = [...keys]
      offSkills.value = []
    }
    return
  }

  if (group === 'mcpServer') {
    if (invert) {
      manualMcp.value = keys.filter((id) => !checkedMcp.value.includes(id))
      offMcp.value = keys.filter((id) => checkedMcp.value.includes(id))
    } else {
      manualMcp.value = [...keys]
      offMcp.value = []
    }
    return
  }

  if (invert) {
    manualExtensions.value = keys.filter((name) => !checkedExtensions.value.includes(name))
    offExtensions.value = keys.filter((name) => checkedExtensions.value.includes(name))
  } else {
    manualExtensions.value = [...keys]
    offExtensions.value = []
  }
}

/** 折叠 / 展开一个分组。 */
const toggleCollapse = (group: string): void => {
  collapsed.value = { ...collapsed.value, [group]: !collapsed.value[group] }
}

/** 读库存。 */
const load = async (): Promise<void> => {
  loading.value = true
  try {
    inventory.value = await listBackupInventory()
  } catch (error) {
    message.error(`读取可导出的数据失败：${error instanceof Error ? error.message : String(error)}`)
    inventory.value = { agents: [], skills: [], mcpServers: [], extensions: [] }
  } finally {
    loading.value = false
  }
}

/** 打包导出。 */
const doExport = async (): Promise<void> => {
  if (exporting.value) return
  exporting.value = true
  try {
    const result = await exportBackup({
      agentIds: manualAgents.value,
      skillNames: checkedSkills.value,
      mcpServerIds: checkedMcp.value,
      extensionNames: checkedExtensions.value,
    })
    message.success(
      `已导出 ${result.fileName}：智能体 ${result.counts.agents} · Skills ${result.counts.skills} · MCP ${result.counts.mcpServers} · 扩展 ${result.counts.extensions}（${result.zipPath}）`,
    )
    emit('close')
  } catch (error) {
    message.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    exporting.value = false
  }
}

// 每次打开都重新读一遍库存 —— 上一次看到的东西可能已经被用户改了。
watch(
  () => props.show,
  (show) => {
    if (!show) return
    manualAgents.value = []
    manualSkills.value = []
    manualMcp.value = []
    manualExtensions.value = []
    offSkills.value = []
    offMcp.value = []
    offExtensions.value = []
    void load()
  },
)
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="backup-export-modal"
    style="width: 620px"
    :bordered="false"
    :mask-closable="false"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">导出数据</h2>
        <p class="modal-sub">把选中的智能体、Skills、MCP server 与 Pi 扩展打成一个 zip。</p>
      </div>
    </header>

    <NSpin :show="loading">
      <div class="groups">
        <!-- 智能体 -->
        <section class="group">
          <header class="group-head">
            <button
              type="button"
              class="group-toggle"
              :aria-expanded="!collapsed.agent"
              @click="toggleCollapse('agent')"
            >
              <NIcon :size="14">
                <ChevronDown v-if="!collapsed.agent" />
                <ChevronRight v-else />
              </NIcon>
              <span class="group-title">智能体</span>
              <span class="group-count tnum"
                >{{ manualAgents.length }} / {{ agentRows.length }}</span
              >
            </button>
            <span class="group-bulk">
              <button type="button" class="link" @click="bulk('agent', false)">全选</button>
              <button type="button" class="link" @click="bulk('agent', true)">反选</button>
            </span>
          </header>
          <ul v-if="!collapsed.agent" class="rows">
            <li v-for="row in agentRows" :key="row.key">
              <button
                type="button"
                class="row"
                :class="{ checked: isChecked('agent', row.key) }"
                :aria-pressed="isChecked('agent', row.key)"
                @click="toggleAgent(row.key)"
              >
                <span class="row-text">
                  <span class="row-label">{{ row.label }}</span>
                  <span class="row-hint">{{ row.hint }}</span>
                </span>
                <span class="row-check" :class="{ on: isChecked('agent', row.key) }">
                  <Check v-if="isChecked('agent', row.key)" :size="13" />
                </span>
              </button>
            </li>
            <li v-if="!agentRows.length" class="empty">没有智能体</li>
          </ul>
        </section>

        <!-- Skills -->
        <section class="group">
          <header class="group-head">
            <button
              type="button"
              class="group-toggle"
              :aria-expanded="!collapsed.skill"
              @click="toggleCollapse('skill')"
            >
              <NIcon :size="14">
                <ChevronDown v-if="!collapsed.skill" />
                <ChevronRight v-else />
              </NIcon>
              <span class="group-title">Skills</span>
              <span class="group-count tnum"
                >{{ checkedSkills.length }} / {{ skillRows.length }}</span
              >
            </button>
            <span class="group-bulk">
              <button type="button" class="link" @click="bulk('skill', false)">全选</button>
              <button type="button" class="link" @click="bulk('skill', true)">反选</button>
            </span>
          </header>
          <ul v-if="!collapsed.skill" class="rows">
            <li v-for="row in skillRows" :key="row.key">
              <button
                type="button"
                class="row"
                :class="{ checked: isChecked('skill', row.key) }"
                :aria-pressed="isChecked('skill', row.key)"
                @click="toggle('skill', row.key)"
              >
                <span class="row-text">
                  <span class="row-label">
                    {{ row.label }}
                    <span v-if="row.pulled" class="tag">随智能体带出</span>
                  </span>
                  <span class="row-hint">{{ row.hint }}</span>
                </span>
                <span class="row-check" :class="{ on: isChecked('skill', row.key) }">
                  <Check v-if="isChecked('skill', row.key)" :size="13" />
                </span>
              </button>
            </li>
            <li v-if="!skillRows.length" class="empty">没有 skill</li>
          </ul>
        </section>

        <!-- MCP server -->
        <section class="group">
          <header class="group-head">
            <button
              type="button"
              class="group-toggle"
              :aria-expanded="!collapsed.mcpServer"
              @click="toggleCollapse('mcpServer')"
            >
              <NIcon :size="14">
                <ChevronDown v-if="!collapsed.mcpServer" />
                <ChevronRight v-else />
              </NIcon>
              <span class="group-title">MCP server</span>
              <span class="group-count tnum">{{ checkedMcp.length }} / {{ mcpRows.length }}</span>
            </button>
            <span class="group-bulk">
              <button type="button" class="link" @click="bulk('mcpServer', false)">全选</button>
              <button type="button" class="link" @click="bulk('mcpServer', true)">反选</button>
            </span>
          </header>
          <ul v-if="!collapsed.mcpServer" class="rows">
            <li v-for="row in mcpRows" :key="row.key">
              <button
                type="button"
                class="row"
                :class="{ checked: isChecked('mcpServer', row.key) }"
                :aria-pressed="isChecked('mcpServer', row.key)"
                @click="toggle('mcpServer', row.key)"
              >
                <span class="row-text">
                  <span class="row-label">
                    {{ row.label }}
                    <span v-if="row.pulled" class="tag">随智能体带出</span>
                  </span>
                  <span class="row-hint">{{ row.hint }}</span>
                </span>
                <span class="row-check" :class="{ on: isChecked('mcpServer', row.key) }">
                  <Check v-if="isChecked('mcpServer', row.key)" :size="13" />
                </span>
              </button>
            </li>
            <li v-if="!mcpRows.length" class="empty">没有 MCP server</li>
          </ul>
        </section>

        <!-- Pi 扩展 -->
        <section class="group">
          <header class="group-head">
            <button
              type="button"
              class="group-toggle"
              :aria-expanded="!collapsed.extension"
              @click="toggleCollapse('extension')"
            >
              <NIcon :size="14">
                <ChevronDown v-if="!collapsed.extension" />
                <ChevronRight v-else />
              </NIcon>
              <span class="group-title">Pi 扩展</span>
              <span class="group-count tnum">
                {{ checkedExtensions.length }} / {{ extensionRows.length }}
              </span>
            </button>
            <span class="group-bulk">
              <button type="button" class="link" @click="bulk('extension', false)">全选</button>
              <button type="button" class="link" @click="bulk('extension', true)">反选</button>
            </span>
          </header>
          <ul v-if="!collapsed.extension" class="rows">
            <li v-for="row in extensionRows" :key="row.key">
              <button
                type="button"
                class="row"
                :class="{ checked: isChecked('extension', row.key) }"
                :aria-pressed="isChecked('extension', row.key)"
                @click="toggle('extension', row.key)"
              >
                <span class="row-text">
                  <span class="row-label">
                    {{ row.label }}
                    <span v-if="row.pulled" class="tag">随智能体带出</span>
                  </span>
                  <span class="row-hint">{{ row.hint }}</span>
                </span>
                <span class="row-check" :class="{ on: isChecked('extension', row.key) }">
                  <Check v-if="isChecked('extension', row.key)" :size="13" />
                </span>
              </button>
            </li>
            <li v-if="!extensionRows.length" class="empty">没有扩展</li>
          </ul>
        </section>
      </div>
    </NSpin>

    <footer class="modal-foot">
      <span class="foot-hint">共 {{ totalChecked }} 项 · 勾选智能体时会自动带上它引用的数据</span>
      <div class="foot-actions">
        <NButton size="small" @click="emit('close')">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="exporting"
          :disabled="!totalChecked"
          @click="doExport"
        >
          <template #icon>
            <NIcon :size="14">
              <Download />
            </NIcon>
          </template>
          导出
        </NButton>
      </div>
    </footer>
  </NModal>
</template>

<style scoped>
.modal-head {
  padding-bottom: 12px;
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

.groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 440px;
  margin-top: 12px;
  overflow-y: auto;
}

.group {
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  background: var(--c-surface-sunken);
  border-bottom: 1px solid var(--c-border);
}

.group-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-text-2);
  cursor: pointer;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.group-count {
  font-size: 11px;
  color: var(--c-text-3);
}

.group-bulk {
  display: flex;
  gap: 10px;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  color: var(--c-text-3);
  cursor: pointer;
}

.link:hover {
  color: var(--c-accent);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 8px;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  text-align: left;
  cursor: pointer;
}

.row:hover {
  border-color: var(--c-border-strong);
}

.row.checked {
  background: var(--c-surface-sunken);
  border-color: var(--c-border-strong);
}

.row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.row-hint {
  overflow: hidden;
  font-size: 10px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「随智能体带出」—— 告诉用户这条是被智能体引用带进来的 */
.tag {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  font-size: 10px;
  font-weight: 400;
  color: var(--c-text-3);
}

.row-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 19px;
  height: 19px;
  border: 1px solid var(--c-text-disabled);
  border-radius: 5px;
  color: #fff;
}

.row-check.on {
  background: var(--c-accent);
  border-color: var(--c-accent);
}

.empty {
  padding: 14px 0;
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

.foot-hint {
  font-size: 11px;
  color: var(--c-text-3);
}

.foot-actions {
  display: flex;
  gap: 8px;
  flex: none;
}
</style>
