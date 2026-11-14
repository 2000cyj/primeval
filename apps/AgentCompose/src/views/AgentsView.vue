<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NIcon, NSelect, NTag, NTooltip, useMessage } from 'naive-ui'
import { ChevronDown, ChevronUp, CircleAlert, Download, Loader2, RefreshCw } from 'lucide-vue-next'
import {
  checkUpdates,
  listInstallations,
  scanAgents,
  type AgentInfo,
  type PackageOp,
  type PackagePlan,
} from '@/api/agents'
import { agentIconBgOf, agentIconOf } from '@/data/agentIcons'
import CliRowMenu, { type CliMenuAction } from '@/components/CliRowMenu.vue'
import PackageOpModal from '@/components/PackageOpModal.vue'
import { setUpgradeDoneHandler, useCliOps } from '@/composables/useCliOps'

const message = useMessage()

const { performOp, opOf, isBusy, hasRunningOp, busyLabel, statusText, failureReason } = useCliOps()

/** 探测结果（真实数据，不带 mock 兜底） */
const agents = ref<AgentInfo[]>([])
const scanning = ref(false)
const scanError = ref('')

const intervals = [
  { label: '15 秒', value: '15s' },
  { label: '30 秒', value: '30s' },
  { label: '1 分钟', value: '1min' },
  { label: '5 分钟', value: '5min' },
]

const refreshInterval = ref('15s')
const nextScan = computed(() => {
  const option = intervals.find((item) => item.value === refreshInterval.value)
  return option?.label ?? '15 秒'
})

/** 检测到的 / 装好的数量 */
const installedCount = computed(() => agents.value.filter((agent) => agent.installed).length)

/** 待确认的包操作（安装 / 升级 / 卸载） */
interface PendingOp {
  op: PackageOp
  /** 目标 agent 的命令名 */
  command: string
  /** 目标 agent 的展示名 */
  name: string
  /** 升级 / 卸载时展示的各处安装 */
  installs: AgentInfo['installs']
  /** 目标版本（升级时用） */
  target: string
}

const pendingOp = ref<PendingOp | null>(null)

/** 正在查最新版本 */
const checkingUpdates = ref(false)

/**
 * 查最新版本 —— 在「本地可用 agent」探测出来之后才做，且只查装上了的。
 *
 * registry 在慢网络下要好几秒，结果晚到就晚到；
 * 没装的工具压根不去问 registry。
 *
 * 升级期间不查：升级完自然会重新扫一遍，那时再查才有意义。
 */
const loadUpdates = async () => {
  if (checkingUpdates.value) return
  // 有操作在跑就不查：装完 / 升完自然会重新扫一遍，那时再查才有意义。
  if (hasRunningOp()) return
  // 只查本地确实装上、且是 npm 分发的
  const targets = agents.value
    .filter((agent) => agent.installed && agent.package)
    .map((agent) => agent.command)
  if (!targets.length) {
    checkingUpdates.value = false
    return
  }
  checkingUpdates.value = true
  try {
    const latest = await checkUpdates(targets)
    for (const item of latest) {
      const agent = agents.value.find((entry) => entry.command === item.command)
      if (!agent || !item.latestVersion) continue
      // 本地版本更高就不提示（预发布通道领先的情况）。
      if (!agent.version || isNewer(item.latestVersion, agent.version)) {
        agent.latestVersion = item.latestVersion
      }
    }
  } catch {
    // 查不到就当没有新版本
  } finally {
    checkingUpdates.value = false
  }
}

/** 比较版本号（只比数字段） */
const isNewer = (latest: string, current: string): boolean => {
  const parse = (value: string) =>
    value
      .trimStart()
      .replace(/^[vV]/, '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => Number(part))
  const left = parse(latest)
  const right = parse(current)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/** 重新探测本机安装情况 */
const runScan = async () => {
  if (scanning.value) return
  scanning.value = true
  scanError.value = ''
  try {
    agents.value = await scanAgents()
    // 版本查询异步跑，不挡这次扫描。
    void loadUpdates()
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : String(error)
    agents.value = []
  } finally {
    scanning.value = false
  }
}

onMounted(() => {
  void runScan()
  // 操作完了重新扫一遍本机安装（操作可能在别的页面发起）
  setUpgradeDoneHandler(() => runScan())
})

onBeforeUnmount(() => {
  setUpgradeDoneHandler(null)
})

/** 打开操作确认：方案与版本选择都在共享弹窗里 */
const openOp = (agent: AgentInfo, op: PackageOp) => {
  pendingOp.value = {
    op,
    command: agent.command,
    name: agent.name,
    installs: agent.installs,
    target: agent.latestVersion ?? '',
  }
}

/**
 * 确认执行。
 *
 * 弹窗**立即关掉**，操作转到后台跑 —— 进度看顶栏通知，列表看状态。
 * npm 的安装可能要跑几十秒，不能让人对着一个弹窗干等。
 */
const confirmOp = (plan: PackagePlan) => {
  const pending = pendingOp.value
  if (!pending) return

  pendingOp.value = null

  void performOp({
    command: plan.command,
    name: plan.name,
    target: pending.target,
    commandLine: plan.commandLine,
    op: pending.op,
    version: plan.version,
  })
}

/** 行内菜单：只有卸载 */
const onRowAction = (action: CliMenuAction, command: string) => {
  if (action !== 'uninstall') return
  const agent = agents.value.find((item) => item.command === command)
  if (!agent) return
  void openOp(agent, 'uninstall')
}

const copyPath = (path: string) => {
  void navigator.clipboard?.writeText(path)
  message.success('路径已复制')
}

/** 状态：可用 / 未安装 / 已安装但跑不起来 */

/** 展开安装位置的 agent（行内展开，同一时刻只展开一个） */
const expandedId = ref<string | null>(null)
/** 展开面板里显示的安装明细（按需拉取，含各处的版本） */
const expandedInstalls = ref<AgentInfo['installs']>([])
/** 明细是否在加载 */
const installsLoading = ref(false)

const toggleInstalls = async (agent: AgentInfo) => {
  if (expandedId.value === agent.id) {
    expandedId.value = null
    return
  }
  expandedId.value = agent.id
  expandedInstalls.value = agent.installs
  // 各处的版本按需再探一次（主扫描只探了 PATH 命中的那处）。
  installsLoading.value = true
  try {
    expandedInstalls.value = await listInstallations(agent.command)
  } catch {
    // 拉不到就沿用扫描时拿到的路径列表
  } finally {
    installsLoading.value = false
  }
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">Agents</h1>
        <p class="page-sub">
          检测本机已安装的 CLI agents 及其版本
          <span v-if="checkingUpdates" class="page-sub-hint">正在检查更新…</span>
        </p>
      </div>
    </header>

    <div class="stack">
      <section class="card row-card">
        <div class="row-text">
          <span class="row-title">自动刷新</span>
          <span class="row-sub">按固定间隔重新检测本机 CLI 安装状态</span>
        </div>
        <div class="row-controls">
          <NSelect
            v-model:value="refreshInterval"
            class="interval-select"
            size="small"
            :options="intervals"
          />
          <NButton size="small" secondary :loading="scanning" @click="runScan">
            <template #icon>
              <NIcon :size="13">
                <RefreshCw />
              </NIcon>
            </template>
            立即检测
          </NButton>
        </div>
      </section>

      <section class="card table-card">
        <header class="table-head">
          <span class="table-title">本地 CLI</span>
          <span class="table-count tnum">{{ installedCount }} / {{ agents.length }}</span>
          <span class="table-foot">下次检测：{{ nextScan }}后</span>
        </header>

        <p v-if="scanError" class="scan-error" role="alert">{{ scanError }}</p>

        <div class="agent-list">
          <div v-for="agent in agents" :key="agent.id" class="agent-block">
            <div class="agent-row agent-grid">
              <div class="cell-agent">
                <span class="cell-icon" :style="{ background: agentIconBgOf(agent.command) }">
                  <img class="cell-icon-img" :src="agentIconOf(agent.command)" :alt="agent.name" />
                </span>
                <div class="cell-text">
                  <span class="cell-title">{{ agent.name }}</span>
                  <div class="cell-path-row">
                    <button
                      v-if="agent.path"
                      class="cell-path mono"
                      type="button"
                      title="点击复制路径"
                      @click="copyPath(agent.path)"
                    >
                      {{ agent.path }}
                    </button>
                    <span v-else class="cell-path mono muted">未检测到</span>
                    <button
                      v-if="agent.installs.length > 1"
                      class="cell-installs"
                      type="button"
                      :aria-expanded="expandedId === agent.id"
                      @click="toggleInstalls(agent)"
                    >
                      另有 {{ agent.installs.length - 1 }} 处安装
                      <NIcon :size="12" class="installs-caret">
                        <ChevronUp v-if="expandedId === agent.id" />
                        <ChevronDown v-else />
                      </NIcon>
                    </button>
                  </div>
                </div>
              </div>

              <div class="cell-version">
                <div class="cell-version-row">
                  <span v-if="agent.installed" class="cell-mono tnum">
                    {{ agent.version ?? '—' }}
                  </span>

                  <!-- 操作进行中：版本列直接展示「安装中 / 升级中 / 卸载中」 -->
                  <span v-if="isBusy(agent.command)" class="cell-op-busy">
                    <NIcon :size="12" class="spin">
                      <Loader2 />
                    </NIcon>
                    {{ busyLabel(agent.command) }}
                  </span>

                  <NButton
                    v-else-if="!agent.installed"
                    size="tiny"
                    secondary
                    @click="openOp(agent, 'install')"
                  >
                    <template #icon>
                      <NIcon :size="13">
                        <Download />
                      </NIcon>
                    </template>
                    安装
                  </NButton>
                  <NButton
                    v-else-if="agent.latestVersion"
                    size="tiny"
                    secondary
                    @click="openOp(agent, 'upgrade')"
                  >
                    <template #icon>
                      <NIcon :size="13">
                        <RefreshCw />
                      </NIcon>
                    </template>
                    升级
                  </NButton>
                </div>
                <!-- 操作结果：真相在顶栏通知里，这里只展示 -->
                <span
                  v-if="statusText(agent.command)"
                  class="cell-upgrade-state"
                  :class="opOf(agent.command)?.status"
                >
                  {{ statusText(agent.command) }}
                  <NTooltip v-if="failureReason(agent.command)" trigger="hover">
                    <template #trigger>
                      <button class="cell-warn" type="button" aria-label="操作失败原因">
                        <CircleAlert :size="13" />
                      </button>
                    </template>
                    <span class="tip-text">{{ failureReason(agent.command) }}</span>
                  </NTooltip>
                </span>
                <span v-else-if="agent.latestVersion" class="cell-new">
                  有新版本 <span class="cell-mono tnum">{{ agent.latestVersion }}</span>
                </span>
                <!-- 跑不起来的真实原因：不铺在列表里，鼠标移上去才看 -->
                <NTooltip v-if="agent.error" trigger="hover">
                  <template #trigger>
                    <button class="cell-warn" type="button" aria-label="运行出错">
                      <CircleAlert :size="13" />
                    </button>
                  </template>
                  <span class="tip-text">{{ agent.error }}</span>
                </NTooltip>
              </div>

              <div class="cell-status">
                <NTag v-if="!agent.installed" size="small" :bordered="false">未安装</NTag>
                <NTag v-else-if="agent.error" size="small" type="warning" :bordered="false">
                  无法运行
                </NTag>
                <NTag v-else size="small" type="success" :bordered="false">可用</NTag>
              </div>

              <div class="cell-actions">
                <!-- 没装的 agent 没什么可操作的（安装走版本列的按钮） -->
                <CliRowMenu
                  v-if="agent.installed"
                  :agent-name="agent.name"
                  :command="agent.command"
                  @action="(action: CliMenuAction, command: string) => onRowAction(action, command)"
                />
              </div>
            </div>

            <!-- 行内展开：检测到 N 处安装 -->
            <div v-if="expandedId === agent.id" class="install-panel">
              <div class="panel-title">
                检测到 {{ agent.installs.length }} 处安装
                <span v-if="installsLoading" class="panel-loading">检测中…</span>
              </div>
              <div v-for="item in expandedInstalls" :key="item.path" class="install-row">
                <span class="install-source">{{ item.source }}</span>
                <span class="install-path" :title="item.path">{{ item.path }}</span>
                <span class="install-version" :class="{ broken: !item.runnable }">
                  {{ item.runnable ? (item.version ?? '版本未知') : '无法运行' }}
                </span>
                <span v-if="item.isPathDefault" class="install-default">默认</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 操作确认：摆出将要执行的命令 + 各处安装（与向导共用同一个弹窗） -->
    <PackageOpModal
      :show="pendingOp !== null"
      :op="pendingOp?.op ?? null"
      :command="pendingOp?.command ?? ''"
      :name="pendingOp?.name ?? ''"
      :installs="pendingOp?.installs ?? []"
      @close="pendingOp = null"
      @confirm="confirmOp"
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

.page-sub-hint {
  margin-left: 6px;
  color: var(--c-text-4);
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

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.row-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
}

.row-text {
  display: flex;
  flex-direction: column;
}

.row-title {
  font-size: 13px;
  font-weight: 600;
}

.row-sub {
  font-size: 12px;
  color: var(--c-text-3);
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.interval-select {
  width: 104px;
}

.scan-error {
  margin: 0;
  padding: 10px 16px;
  background: rgb(180 35 24 / 10%);
  font-size: 12px;
  color: #b42318;
}

.table-card {
  overflow: hidden;
}

.table-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--c-border);
}

.table-title {
  font-size: 13px;
  font-weight: 600;
}

.table-count {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-3);
}

.table-foot {
  margin-left: auto;
  font-size: 12px;
  color: var(--c-text-4);
}
</style>

<style>
.cell-agent {
  display: flex;
  align-items: center;
  gap: 10px;
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

.cell-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.cell-title {
  font-size: 13px;
  font-weight: 500;
}

.cell-path {
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-path:hover {
  color: var(--c-accent);
  text-decoration: underline;
}

.cell-version {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-version-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cell-mono {
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
}

.cell-new {
  font-size: 11px;
  color: var(--c-accent);
}

/* 操作进行中：版本列里的「安装中 / 升级中 / 卸载中」 */
.cell-op-busy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgb(28 28 26 / 8%);
  font-size: 11px;
  color: var(--c-accent);
}

/* 操作状态（进行中 / 已完成 / 失败） */
.cell-upgrade-state {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  font-size: 11px;
}

.cell-upgrade-label {
  flex: none;
}

.cell-upgrade-state.running {
  color: var(--c-accent);
}

.cell-upgrade-state.success {
  color: var(--c-success);
}

.cell-upgrade-state.error {
  color: var(--c-danger);
}

/* 感叹号：真正的错误内容在悬浮提示里 */
.cell-warn {
  display: inline-flex;
  align-items: center;
  padding: 0;
  color: var(--c-danger);
  cursor: help;
  background: none;
  border: none;
}

.tip-text {
  display: block;
  max-width: 420px;
  line-height: 1.6;
  word-break: break-word;
}

/* 列表（自定义行，替代 DataTable：要支持行内展开） */
.agent-list {
  display: flex;
  flex-direction: column;
}

.agent-block {
  border-bottom: 1px solid var(--c-border);
}

.agent-block:last-child {
  border-bottom: none;
}

.agent-row {
  display: grid;
  grid-template-columns: 48% 26% 16% 6%;
  align-items: center;
  column-gap: 12px;
  padding: 12px 16px;
  transition: background 0.15s;
}

.agent-row:hover {
  background: var(--c-surface-sunken);
}

.cell-agent {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cell-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cell-status {
  display: flex;
  align-items: center;
}

/* 「另有 N 处安装」：点开展开 */
.cell-installs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 11px;
  color: #a16207;
  cursor: pointer;
}

.cell-installs:hover {
  text-decoration: underline;
}

.installs-caret {
  flex: none;
}

/* 行内展开面板 */
.install-panel {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgb(161 98 7 / 10%);
}

.panel-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-weight: 500;
  color: #a16207;
}

.panel-loading {
  font-weight: 400;
  color: var(--c-text-4);
}

.install-error {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: #b42318;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.warn-icon {
  color: #a16207;
}

.upgrade-block {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: #faf6ee;
}

.upgrade-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text);
}

.upgrade-will {
  margin-top: 10px;
  font-size: 11px;
  color: var(--c-text-3);
}

.upgrade-command {
  display: block;
  overflow: hidden;
  padding: 3px 6px;
  border-radius: 3px;
  background: var(--c-surface);
  font-family: var(--c-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--c-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-sub {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.upgrade-command {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 12px;
  color: var(--c-text-2);
  word-break: break-all;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.cell-error {
  font-size: 11px;
  line-height: 1.5;
  color: #b42318;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.cell-path.muted {
  color: var(--c-text-4);
  cursor: default;
}

.cell-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.cell-muted {
  font-size: 12px;
  color: var(--c-text-3);
}
</style>
