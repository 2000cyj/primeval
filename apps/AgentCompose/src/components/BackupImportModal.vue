<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NIcon, NModal, NProgress, NSpin, useMessage } from 'naive-ui'
import { CheckCircle2, ChevronDown, ChevronRight, FileUp, TriangleAlert } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import {
  backupConflictType,
  backupOverwriteKey,
  importBackup,
  inspectBackup,
  onBackupImportDone,
  onBackupImportProgress,
  type BackupConflict,
  type BackupConflictReport,
  type BackupConflictType,
  type BackupImportResult,
} from '@/api/backup'
import { useNotifications } from '@/composables/useNotifications'

/**
 * 导入弹窗：选一个导出的 zip → 看冲突 → 决定哪些要覆盖 → 导入。
 *
 * 三步：
 * 1. 选文件（系统文件对话框，前端只拿路径）
 * 2. 看冲突清单 —— 每条一个「覆盖」勾选框，默认全不勾
 * 3. 导入结果（成功 / 跳过 / 失败明细）
 *
 * 默认不勾覆盖是有意的：导入是增量动作，不该把本机已有的东西悄悄换掉。
 *
 * # 导入是异步的
 *
 * 导入可能要拉远程仓库（远程 skill 重新 clone）、跑 npm install（远程扩展）——
 * 几十秒起步。所以确认后不是「等它跑完」，而是「启动它」：
 * 后端立刻返回 taskId，进度与结果走事件。
 *
 * 进度写到顶栏的通知里 —— 用户可以关掉弹窗去干别的，导入照样跑完，
 * 跑完了铃铛里能看到结果。
 */
const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const message = useMessage()
const { start: startNotice, finish: finishNotice } = useNotifications()

/** 弹窗当前在哪一步。 */
type Step = 'pick' | 'confirm' | 'running' | 'done'

const step = ref<Step>('pick')
/** 选文件 / 解析 / 导入各自的进行中状态 */
const picking = ref(false)
const inspecting = ref(false)
const importing = ref(false)
/** 导入任务在后台跑（弹窗已关闭也没关系） */
const running = ref(false)
/** 后端给的任务 id */
const taskId = ref('')
/** 顶栏通知的 id —— 跑完要改它 */
const noticeId = ref('')
/** 进度：当前这一步在做什么 */
const progressText = ref('')
/** 进度：当前阶段（导入 Skills / 导入 MCP …） */
const progressPhase = ref('')
/** 进度：已完成条数 */
const progressCurrent = ref(0)
/** 进度：总条数 */
const progressTotal = ref(0)
/** 事件订阅的取消函数（换包 / 重开时收掉旧的） */
const unlisteners = ref<(() => void)[]>([])
/** 选中的 zip 路径 */
const zipPath = ref('')
/** 冲突报告 */
const report = ref<BackupConflictReport | null>(null)
/** 勾了「覆盖」的冲突（存的是 `类别:标识`） */
const overwriteKeys = ref<string[]>([])
/** 导入结果 */
const result = ref<BackupImportResult | null>(null)

/** 类别 → 中文名（冲突列表里给个能看懂的分类）。 */
const typeLabels: Record<string, string> = {
  agent: '智能体',
  skill: 'Skills',
  mcpServer: 'MCP server',
  extension: 'Pi 扩展',
}

/** 一个冲突分组。 */
interface ConflictGroup {
  /** 类别（也是拼覆盖 key 用的）。 */
  type: BackupConflictType
  /** 展示名。 */
  label: string
  /** 该组的冲突条目。 */
  items: BackupConflict[]
  /** 已勾覆盖的条数。 */
  checkedCount: number
}

/** 冲突清单（模板里直接用，避免到处判空）。 */
const conflicts = computed(() => report.value?.conflicts ?? [])

/**
 * 冲突按类型分组。
 *
 * 跟导出弹窗的分组一一对应（智能体 / Skills / MCP server / Pi 扩展）——
 * 两边分类一样，用户看导出包里的东西和看冲突的时候不用换脑子。
 *
 * 固定顺序：先智能体（它是总纲），再 Skills、MCP、扩展。
 */
const conflictGroups = computed<ConflictGroup[]>(() => {
  const order: BackupConflictType[] = ['agent', 'skill', 'mcpServer', 'extension']
  const groups: ConflictGroup[] = []
  for (const type of order) {
    const items = conflicts.value.filter((conflict) => backupConflictType(conflict) === type)
    if (!items.length) continue
    groups.push({
      type,
      label: typeLabels[type] ?? '数据',
      items,
      /** 该组里已经勾了覆盖的条数 */
      checkedCount: items.filter(isOverwrite).length,
    })
  }
  return groups
})

/** 某个分组的折叠状态。 */
const collapsed = ref<Record<string, boolean>>({})

/** 折叠 / 展开一个分组。 */
const toggleCollapse = (type: string): void => {
  collapsed.value = { ...collapsed.value, [type]: !collapsed.value[type] }
}

/**
 * 一组「全选覆盖」。
 *
 * 全选 = 该组所有冲突都勾上覆盖；已经全勾了再点 = 全取消。
 */
const toggleGroupOverwrite = (group: ConflictGroup): void => {
  const keys = group.items
    .map((conflict) => backupOverwriteKey(conflict))
    .filter((key): key is string => key !== null)
  if (!keys.length) return
  const allChecked = keys.every((key) => overwriteKeys.value.includes(key))
  if (allChecked) {
    overwriteKeys.value = overwriteKeys.value.filter((key) => !keys.includes(key))
    return
  }
  overwriteKeys.value = [
    ...overwriteKeys.value,
    ...keys.filter((key) => !overwriteKeys.value.includes(key)),
  ]
}

/** 解析阶段后端给的提醒。 */
const reportWarnings = computed(() => report.value?.warnings ?? [])

/** 包里一共有什么。 */
const summary = computed(
  () => report.value?.summary ?? { agents: 0, skills: 0, mcpServers: 0, extensions: 0 },
)

/** 导入失败的条目。 */
const failures = computed(() => result.value?.failures ?? [])

/** 导入后的提醒。 */
const resultWarnings = computed(() => result.value?.warnings ?? [])

/** 勾了覆盖的条数。 */
const overwriteCount = computed(() => overwriteKeys.value.length)

/** 会直接导入的条数（不冲突的 + 勾了覆盖的）。 */
const importCount = computed(() => (report.value?.freshCount ?? 0) + overwriteCount.value)

/** 会被跳过的条数（没勾覆盖的冲突）。 */
const skipCount = computed(() => (report.value?.conflicts.length ?? 0) - overwriteCount.value)

/** 选一个 zip 文件。 */
const pickFile = async (): Promise<void> => {
  if (picking.value) return
  picking.value = true
  try {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'AgentSpace 导出包', extensions: ['zip'] }],
    })
    if (!picked) return
    zipPath.value = picked
    await inspect(picked)
  } catch (error) {
    message.error(`选择文件失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    picking.value = false
  }
}

/** 解析包，比对本地。 */
const inspect = async (path: string): Promise<void> => {
  inspecting.value = true
  try {
    report.value = await inspectBackup(path)
    overwriteKeys.value = []
    step.value = 'confirm'
  } catch (error) {
    message.error(`解析失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    inspecting.value = false
  }
}

/** 某条冲突勾了覆盖没有。 */
const isOverwrite = (conflict: BackupConflict): boolean => {
  const key = backupOverwriteKey(conflict)
  return key ? overwriteKeys.value.includes(key) : false
}

/** 勾 / 取消一条冲突的覆盖。 */
const toggleOverwrite = (conflict: BackupConflict): void => {
  const key = backupOverwriteKey(conflict)
  if (!key) return
  overwriteKeys.value = overwriteKeys.value.includes(key)
    ? overwriteKeys.value.filter((item) => item !== key)
    : [...overwriteKeys.value, key]
}

/** 确认导入。 */
/**
 * 确认导入 —— 只是**启动**它。
 *
 * 后端把活丢到后台跑，立刻返回 taskId。真正的进度与结果走事件，
 * 这里先把通知准备好（顶栏铃铛里能看到）。
 */
const doImport = async (): Promise<void> => {
  if (importing.value) return
  importing.value = true
  try {
    // 先订阅再启动 —— 反过来的话，快任务可能在订阅之前就发完了
    const unlistenProgress = await onBackupImportProgress((progress) => {
      if (progress.taskId !== taskId.value) return
      progressText.value = progress.message
      progressPhase.value = progress.phase
      progressCurrent.value = progress.current
      progressTotal.value = progress.total
    })
    const unlistenDone = await onBackupImportDone((done) => {
      if (done.taskId !== taskId.value) return
      onImportDone(done)
    })
    // 记下取消函数 —— 换个包/重开弹窗时要把旧的订阅收掉，
    // 否则旧任务的进度会串到新任务上。
    unlisteners.value = [unlistenProgress, unlistenDone]

    const id = await importBackup({
      zipPath: zipPath.value,
      overwriteKeys: overwriteKeys.value,
    })
    taskId.value = id

    // 通知：一条「进行中」的，跑完改成结果
    noticeId.value = startNotice('正在导入数据', '准备中')
    running.value = true
    // 弹窗可以关了 —— 导入在后台跑，跑完铃铛里能看到结果
    step.value = 'running'
  } catch (error) {
    message.error(`导入失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    importing.value = false
  }
}

/** 导入结束（后端推的）。 */
const onImportDone = (done: {
  taskId: string
  result?: BackupImportResult
  error?: string
}): void => {
  running.value = false
  if (done.error) {
    message.error(`导入失败：${done.error}`)
    finishNotice(noticeId.value, 'error', {
      title: '导入失败',
      detail: done.error,
    })
    step.value = 'confirm'
    return
  }
  const imported = done.result?.imported
  const total =
    (imported?.agents ?? 0) +
    (imported?.skills ?? 0) +
    (imported?.mcpServers ?? 0) +
    (imported?.extensions ?? 0)
  const skipped =
    (done.result?.skipped.agents ?? 0) +
    (done.result?.skipped.skills ?? 0) +
    (done.result?.skipped.mcpServers ?? 0) +
    (done.result?.skipped.extensions ?? 0)
  const detail = `导入 ${total} 项，跳过 ${skipped} 项`
  finishNotice(noticeId.value, 'success', {
    title: '导入完成',
    detail: done.result?.failures.length
      ? `${detail}（${done.result.failures.length} 项失败）`
      : detail,
  })
  result.value = done.result ?? null
  step.value = 'done'
}

/** 回到第一步（换一个包）。 */
const backToPick = (): void => {
  // 旧的订阅收掉 —— 否则旧任务的进度会串到新任务上
  for (const unlisten of unlisteners.value) unlisten()
  unlisteners.value = []
  step.value = 'pick'
  report.value = null
  result.value = null
  overwriteKeys.value = []
  zipPath.value = ''
  taskId.value = ''
  noticeId.value = ''
  running.value = false
  progressText.value = ''
  progressPhase.value = ''
  progressCurrent.value = 0
  progressTotal.value = 0
}

// 每次打开都从头开始 —— 上一次选的包不该被记着。
watch(
  () => props.show,
  (show) => {
    if (!show) return
    for (const unlisten of unlisteners.value) unlisten()
    unlisteners.value = []
    step.value = 'pick'
    report.value = null
    result.value = null
    overwriteKeys.value = []
    zipPath.value = ''
    taskId.value = ''
    noticeId.value = ''
    running.value = false
    progressText.value = ''
    progressPhase.value = ''
    progressCurrent.value = 0
    progressTotal.value = 0
  },
)
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="backup-import-modal"
    style="width: 620px"
    :bordered="false"
    :mask-closable="false"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">导入数据</h2>
        <p class="modal-sub">把别的机器（或备份）导出的 zip 导回本机。</p>
      </div>
      <!--
        这里不放关闭按钮。
        AgentSpace 是自绘标题栏（Windows 上没有系统标题栏），窗口右上角本来
        就有一个 ✕。弹窗再放一个，两个 ✕ 会在屏幕右上角并排 —— 用户分不清
        点的是关弹窗还是关整个应用。关弹窗用底部的「取消」。
      -->
    </header>

    <!-- 第一步：选文件 -->
    <div v-if="step === 'pick'" class="pick">
      <button type="button" class="pick-btn" :disabled="picking || inspecting" @click="pickFile">
        <NIcon :size="20">
          <FileUp />
        </NIcon>
        <span class="pick-title">{{
          picking ? '正在打开文件对话框…' : '选择导出的 zip 文件'
        }}</span>
        <span class="pick-hint">只能选 AgentSpace 导出的包（有 manifest.json 的那个）</span>
      </button>
      <p v-if="inspecting" class="pick-status">正在解析并比对本地数据…</p>
    </div>

    <!-- 第二步：冲突清单 -->
    <div v-else-if="step === 'confirm'" class="confirm">
      <div class="summary">
        <span class="summary-title">将导入 {{ importCount }} 项，跳过 {{ skipCount }} 项</span>
        <span class="summary-detail">
          包里有智能体 {{ summary.agents }} · Skills {{ summary.skills }} · MCP
          {{ summary.mcpServers }} · 扩展 {{ summary.extensions }}
        </span>
      </div>

      <ul v-if="reportWarnings.length" class="warnings">
        <li v-for="warning in reportWarnings" :key="warning" class="warning-item">
          <NIcon :size="13">
            <TriangleAlert />
          </NIcon>
          <span>{{ warning }}</span>
        </li>
      </ul>

      <div v-if="conflicts.length" class="conflicts">
        <p class="conflicts-hint">下面这些本机已经有了 —— 勾了「覆盖」才会替换掉本机的那份。</p>
        <!-- 按类型分组：跟导出弹窗的分组一致 -->
        <section v-for="group in conflictGroups" :key="group.type" class="conflict-group">
          <header class="group-head">
            <button
              type="button"
              class="group-toggle"
              :aria-expanded="!collapsed[group.type]"
              @click="toggleCollapse(group.type)"
            >
              <NIcon :size="14">
                <ChevronDown v-if="!collapsed[group.type]" />
                <ChevronRight v-else />
              </NIcon>
              <span class="group-title">{{ group.label }}</span>
              <span class="group-count tnum"
                >{{ group.checkedCount }} / {{ group.items.length }}</span
              >
            </button>
            <!-- 分组全选：全勾 / 全取消 -->
            <NCheckbox
              class="group-all"
              :checked="group.checkedCount === group.items.length"
              :indeterminate="group.checkedCount > 0 && group.checkedCount < group.items.length"
              @update:checked="toggleGroupOverwrite(group)"
            >
              全选覆盖
            </NCheckbox>
          </header>
          <ul v-if="!collapsed[group.type]" class="conflict-list">
            <li
              v-for="conflict in group.items"
              :key="`${conflict.key}-${group.type}`"
              class="conflict"
            >
              <div class="conflict-text">
                <span class="conflict-head">
                  <span class="conflict-name">{{ conflict.label }}</span>
                </span>
                <span class="conflict-hint">
                  本机：{{ conflict.localHint || '（没有说明）' }}
                </span>
                <span class="conflict-hint">
                  包里：{{ conflict.incomingHint || '（没有说明）' }}
                </span>
              </div>
              <NCheckbox
                v-if="backupOverwriteKey(conflict)"
                class="conflict-check"
                :checked="isOverwrite(conflict)"
                @update:checked="toggleOverwrite(conflict)"
              >
                覆盖
              </NCheckbox>
            </li>
          </ul>
        </section>
      </div>

      <p v-else class="no-conflict">
        没有冲突，这个包会直接导入 {{ report?.freshCount ?? 0 }} 项。
      </p>
    </div>

    <!-- 导入中（后台跑，弹窗只是告诉用户进度） -->
    <div v-else-if="step === 'running'" class="running">
      <div class="running-head">
        <NSpin :size="20" />
        <span class="running-title">{{ progressPhase || '正在导入' }}</span>
      </div>
      <p class="running-item">{{ progressText || '正在准备…' }}</p>
      <NProgress
        type="line"
        :percentage="
          progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : undefined
        "
        :indeterminate="progressTotal <= 0"
        :height="4"
        :show-indicator="false"
        processing
      />
      <p class="running-hint">导入在后台跑着 —— 可以关掉这个窗口，完成后顶栏铃铛里会看到结果。</p>
    </div>

    <!-- 第三步：结果 -->
    <div v-else class="done">
      <div class="done-head">
        <NIcon :size="18" class="done-icon">
          <CheckCircle2 />
        </NIcon>
        <span class="done-title">导入完成</span>
      </div>

      <div class="counts">
        <div class="count-cell">
          <span class="count-value tnum">{{ result?.imported.agents ?? 0 }}</span>
          <span class="count-label">智能体</span>
        </div>
        <div class="count-cell">
          <span class="count-value tnum">{{ result?.imported.skills ?? 0 }}</span>
          <span class="count-label">Skills</span>
        </div>
        <div class="count-cell">
          <span class="count-value tnum">{{ result?.imported.mcpServers ?? 0 }}</span>
          <span class="count-label">MCP</span>
        </div>
        <div class="count-cell">
          <span class="count-value tnum">{{ result?.imported.extensions ?? 0 }}</span>
          <span class="count-label">扩展</span>
        </div>
        <div class="count-cell">
          <span class="count-value tnum">
            {{
              (result?.skipped.agents ?? 0) +
              (result?.skipped.skills ?? 0) +
              (result?.skipped.mcpServers ?? 0) +
              (result?.skipped.extensions ?? 0)
            }}
          </span>
          <span class="count-label">跳过</span>
        </div>
      </div>

      <ul v-if="failures.length" class="failures">
        <li v-for="failure in failures" :key="failure" class="failure-item">
          <NIcon :size="13">
            <TriangleAlert />
          </NIcon>
          <span>{{ failure }}</span>
        </li>
      </ul>

      <ul v-if="resultWarnings.length" class="warnings">
        <li v-for="warning in resultWarnings" :key="warning" class="warning-item">
          <NIcon :size="13">
            <TriangleAlert />
          </NIcon>
          <span>{{ warning }}</span>
        </li>
      </ul>
    </div>

    <footer class="modal-foot">
      <div class="foot-left">
        <button v-if="step !== 'pick'" type="button" class="link" @click="backToPick">
          换个文件
        </button>
      </div>
      <div class="foot-actions">
        <NButton size="small" @click="emit('close')">{{
          step === 'done' ? '完成' : step === 'running' ? '后台运行' : '取消'
        }}</NButton>
        <NButton
          v-if="step === 'confirm'"
          size="small"
          type="primary"
          :loading="importing"
          @click="doImport"
        >
          确认导入
        </NButton>
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

/* ── 第一步：选文件 ── */

.pick {
  padding: 20px 0 8px;
}

.pick-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 28px 16px;
  border: 1px dashed var(--c-border-strong);
  border-radius: var(--radius);
  background: var(--c-surface-sunken);
  color: var(--c-text-2);
  cursor: pointer;
}

.pick-btn:hover:not(:disabled) {
  border-color: var(--c-accent);
  color: var(--c-accent);
}

.pick-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.pick-title {
  font-size: 13px;
  font-weight: 600;
}

.pick-hint {
  font-size: 11px;
  color: var(--c-text-3);
}

.pick-status {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}

/* ── 第二步：冲突清单 ── */

.confirm {
  max-height: 440px;
  margin-top: 12px;
  overflow-y: auto;
}

.summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 10px;
}

.summary-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.summary-detail {
  font-size: 11px;
  color: var(--c-text-3);
}

.conflicts-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--c-text-3);
}

/* ── 冲突分组（跟导出弹窗的分组一一对应）── */

.conflict-group {
  margin-bottom: 8px;
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

.group-all {
  flex: none;
}

/* naive-ui 的标签字号比正文大 —— 改小一点，跟旁边的「覆盖」一致 */
.group-all :deep(.n-checkbox__label) {
  font-size: 11px;
  color: var(--c-text-3);
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 8px;
  list-style: none;
}

.conflict {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.conflict-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.conflict-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conflict-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.conflict-hint {
  font-size: 10px;
  color: var(--c-text-3);
  word-break: break-all;
}

.conflict-check {
  flex: none;
}

.no-conflict {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ── 第三步：结果 ── */

.done {
  margin-top: 12px;
}

.done-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
}

.done-icon {
  color: var(--c-success);
}

.done-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.counts {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  padding: 10px 0;
  border-top: 1px solid var(--c-border);
  border-bottom: 1px solid var(--c-border);
}

.count-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.count-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text);
}

.count-label {
  font-size: 10px;
  color: var(--c-text-3);
}

.failures,
.warnings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.failure-item,
.warning-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  color: var(--c-text-2);
}

.failure-item {
  color: var(--c-danger);
}

.warning-item {
  color: var(--c-warning);
}

/* ── 底部 ── */

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--c-border);
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

.foot-actions {
  display: flex;
  gap: 8px;
}

/* ── 导入中 ── */

.running {
  padding: 28px 4px 12px;
}

.running-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.running-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.running-item {
  margin: 10px 0 12px;
  font-size: 12px;
  color: var(--c-text-2);
}

.running-hint {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
