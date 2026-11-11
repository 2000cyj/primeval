<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NModal, NSelect, NSpin, useMessage } from 'naive-ui'
import { AlertTriangle } from 'lucide-vue-next'
import {
  getPackagePlan,
  getPackageVersions,
  type AgentInfo,
  type PackageOp,
  type PackagePlan,
} from '@/api/agents'

/**
 * 包操作确认弹窗（安装 / 升级 / 卸载）。
 *
 * agents 页与新建智能体向导共用 —— 摆出「将要执行的命令」，
 * 确认后转后台执行（进度在顶栏通知里）。
 *
 * 安装时还能选版本（从 npm registry 拉可选版本）。
 */
const props = defineProps<{
  show: boolean
  /** 做什么 */
  op: PackageOp | null
  /** 目标 agent 的命令名 */
  command: string
  /** 目标 agent 的展示名 */
  name: string
  /** 升级 / 卸载时展示的各处安装 */
  installs?: AgentInfo['installs']
}>()

const emit = defineEmits<{
  close: []
  /** 确认：带上实际要执行的方案 */
  confirm: [plan: PackagePlan, op: PackageOp]
}>()

const message = useMessage()

/** 当前方案 */
const plan = ref<PackagePlan | null>(null)
/** 可选版本（安装时才有） */
const versions = ref<string[]>([])
/** 选中的版本 */
const version = ref('latest')
/** 正在读 */
const loading = ref(false)

/** 版本下拉的选项：latest 在最前 */
const versionOptions = computed(() => [
  { label: '最新（latest）', value: 'latest' },
  ...versions.value.map((item) => ({ label: item, value: item })),
])

/** 拉方案（版本变了也要重拉 —— 命令行里的版本号要跟着变） */
const loadPlan = async () => {
  if (!props.op) return
  loading.value = true
  try {
    plan.value = await getPackagePlan(
      props.command,
      props.op,
      props.op === 'install' ? version.value : undefined,
    )
  } catch (error) {
    plan.value = null
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

/** 打开时：读版本列表 + 拉方案 */
watch(
  () => props.show,
  async (show) => {
    if (!show || !props.op) return
    version.value = 'latest'
    plan.value = null
    versions.value = []
    loading.value = true
    if (props.op === 'install') {
      try {
        versions.value = await getPackageVersions(props.command)
      } catch {
        // 读不到版本列表不致命 —— 至少还能装 latest
        versions.value = []
      }
    }
    await loadPlan()
  },
)

/** 换版本 → 重新拉方案 */
const onVersionChange = async (value: string) => {
  version.value = value
  await loadPlan()
}

/** 弹窗标题 */
const title = computed(() => {
  if (props.op === 'install') return '确认安装'
  if (props.op === 'uninstall') return '确认卸载'
  return '确认升级位置'
})

/** 弹窗里的说明 */
const sub = computed(() => {
  if (props.op === 'install') return '将用包管理器全局安装这个 CLI agent。'
  if (props.op === 'uninstall') return '卸载后本机就不再有这个 CLI agent 了。'
  return '检测到多处安装。本次升级不会全部更新，具体作用的位置以下方各项为准。'
})

/** 确认按钮上的字 */
const verb = computed(() => {
  if (props.op === 'install') return '确认安装'
  if (props.op === 'uninstall') return '确认卸载'
  return '确认升级'
})

const confirm = () => {
  if (!plan.value || !props.op) return
  emit('confirm', plan.value, props.op)
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    style="width: 520px"
    :bordered="false"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <template #header>
      <div class="modal-head">
        <NIcon :size="16" class="warn-icon">
          <AlertTriangle />
        </NIcon>
        <span class="modal-title">{{ title }}</span>
      </div>
    </template>

    <template v-if="props.op === 'install' && versions.length">
      <div class="version-row">
        <label class="version-label" for="pkg-version">装哪个版本</label>
        <NSelect
          id="pkg-version"
          :value="version"
          class="version-select"
          size="small"
          :options="versionOptions"
          @update:value="onVersionChange"
        />
      </div>
    </template>

    <template v-if="plan">
      <p class="modal-sub">{{ sub }}</p>
      <div class="upgrade-block">
        <div class="upgrade-name">{{ plan.name }}</div>
        <ul v-if="props.installs?.length" class="install-list">
          <li v-for="item in props.installs" :key="item.path" class="install-row">
            <span class="install-source">{{ item.source }}</span>
            <span class="install-path" :title="item.path">{{ item.path }}</span>
            <span class="install-version" :class="{ broken: !item.runnable }">
              {{ item.runnable ? (item.version ?? '版本未知') : '无法运行' }}
            </span>
            <span v-if="item.isPathDefault" class="install-default">默认</span>
          </li>
        </ul>
        <div class="upgrade-will">将执行：</div>
        <code class="upgrade-command">{{ plan.commandLine }}</code>
      </div>
    </template>

    <div v-else-if="loading" class="loading-row">
      <NSpin size="small" />
      <span>正在读取…</span>
    </div>

    <div class="modal-actions">
      <NButton size="small" @click="emit('close')">取消</NButton>
      <NButton size="small" type="primary" :loading="loading" :disabled="!plan" @click="confirm">
        {{ verb }}
      </NButton>
    </div>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.warn-icon {
  color: #d97745;
}

.upgrade-block {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: #fff7ed;
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
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-family: var(--c-font-mono, ui-monospace, monospace);
  font-size: 12px;
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

/* 版本选择 */
.version-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.version-label {
  flex: none;
  font-size: 12px;
  color: var(--c-text-2);
}

.version-select {
  flex: 1;
  min-width: 0;
}

.loading-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>

<style>
/* 安装位置列表（agents 页与向导共用这套排版） */
.install-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.install-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.install-source {
  flex: none;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--c-surface-sunken);
  font-family: var(--c-font-mono, ui-monospace, monospace);
  color: var(--c-text-3);
}

.install-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--c-font-mono, ui-monospace, monospace);
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-version {
  flex: none;
  font-family: var(--c-font-mono, ui-monospace, monospace);
  color: var(--c-text-2);
}

.install-version.broken {
  color: #be123c;
}

.install-default {
  flex: none;
  padding: 1px 6px;
  border: 1px solid rgb(79 70 229 / 30%);
  border-radius: 999px;
  background: rgb(79 70 229 / 10%);
  font-size: 10px;
  color: #4f46e5;
}
</style>
