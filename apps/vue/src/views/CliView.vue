<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElButton, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import AppIcon from '../components/icons/AppIcon.vue'
import { useToast } from '../composables/useToast'
import { cliScanMeta, initialCliTools } from '../mocks/cliTools'

const { push } = useToast()

const cliTools = ref([...initialCliTools])
const scanning = ref(false)
const autoRefresh = ref(false)
const interval = ref(cliScanMeta.defaultInterval)

const readyCount = computed(() => cliTools.value.filter((item) => item.status === 'ready').length)
const pendingCount = computed(() => cliTools.value.filter((item) => item.status === 'login').length)

// 扫描定时器：离开页面时清理，避免卸载后仍弹 toast
let scanTimer: number | undefined

const startScan = () => {
  if (scanning.value) return
  scanning.value = true
  scanTimer = window.setTimeout(() => {
    scanTimer = undefined
    scanning.value = false
    push(`扫描完成，共发现 ${cliTools.value.length} 个本地 CLI`)
  }, 1200)
}

onBeforeUnmount(() => {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer)
    scanTimer = undefined
  }
})

const statusMeta = (status: string) =>
  status === 'ready'
    ? { text: '可用', type: 'success' as const }
    : { text: '需要登录', type: 'warning' as const }
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">LOCAL CLI AGENTS</div>
        <h1 class="title">智能体</h1>
        <p>扫描并管理当前设备已安装的智能体 CLI</p>
      </div>
      <div class="heading-actions">
        <ElButton type="primary" :loading="scanning" @click="startScan">
          <Refresh />
          {{ scanning ? '刷新中…' : '立即刷新' }}
        </ElButton>
      </div>
    </header>

    <div v-if="scanning" class="scan-progress">
      <strong>扫描中</strong>
      <span class="bar"><i style="width: 62%" /></span>
      <span>正在检查 PATH 与常用安装目录…</span>
    </div>

    <div class="local-only-banner">
      <span class="local-banner-icon"><AppIcon name="terminal" :size="20" /></span>
      <span class="copy">
        <strong>仅扫描本地 CLI</strong>
        <span>{{ cliScanMeta.scope }}</span>
      </span>
      <span class="device-chip">{{ cliScanMeta.device }}</span>
    </div>

    <section class="scan-overview">
      <div class="scan-stat">
        <span>已发现 CLI</span>
        <strong>{{ cliTools.length }}</strong>
        <small>当前设备</small>
      </div>
      <div class="scan-stat">
        <span>可直接使用</span>
        <strong class="green-number">{{ readyCount }}</strong>
        <small>环境正常</small>
      </div>
      <div class="scan-stat">
        <span>需要处理</span>
        <strong class="amber-number">{{ pendingCount }}</strong>
        <small>登录或配置</small>
      </div>
      <div class="scan-meta-card">
        <span class="scan-meta-icon"><AppIcon name="clock" :size="18" /></span>
        <span class="copy">
          <span>上次扫描</span>
          <strong>{{ cliScanMeta.lastScanAt }}</strong>
        </span>
        <small>耗时 {{ cliScanMeta.lastDuration }}</small>
      </div>
    </section>

    <section class="schedule-panel">
      <div class="schedule-copy">
        <span class="schedule-icon"><AppIcon name="timer" :size="18" /></span>
        <span class="copy">
          <strong>定时刷新</strong>
          <span>按设定间隔自动重新扫描本地 CLI 安装状态</span>
        </span>
      </div>
      <div class="schedule-controls">
        <ElSwitch v-model="autoRefresh" aria-label="启用 定时刷新" />
        <span class="interval-prefix">每</span>
        <ElSelect
          v-model="interval"
          :disabled="!autoRefresh"
          class="interval-select"
          aria-label="定时刷新间隔"
        >
          <ElOption v-for="item in cliScanMeta.intervals" :key="item" :label="item" :value="item" />
        </ElSelect>
      </div>
    </section>

    <section class="cli-panel">
      <div class="cli-panel-head">
        <span>
          <strong>本地 CLI</strong>
          <span class="sub">共发现 {{ cliTools.length }} 个</span>
        </span>
        <span class="scan-status"><span />扫描服务正常</span>
      </div>

      <ElTable :data="cliTools" class="cli-table" style="width: 100%">
        <ElTableColumn label="智能体" min-width="180">
          <template #default="scope">
            <span class="cli-name">
              <span class="cli-logo" :class="scope.row.iconColor">
                <AppIcon :name="scope.row.icon" :size="20" />
              </span>
              <span class="copy">
                <strong>{{ scope.row.name }}</strong>
                <span>{{ scope.row.desc }}</span>
              </span>
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="命令与路径" min-width="220">
          <template #default="scope">
            <span class="cli-command">
              <code>{{ scope.row.command }}</code>
              <span>{{ scope.row.path }}</span>
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="版本" width="120">
          <template #default="scope">
            <span class="version-code">{{ scope.row.version }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="190">
          <template #default="scope">
            <ElTag size="small" :type="statusMeta(scope.row.status).type" effect="light">
              {{ statusMeta(scope.row.status).text }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="最近发现" width="120">
          <template #default="scope">
            <span class="last-seen">{{ scope.row.seen }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn width="110">
          <template #default="scope">
            <button
              class="cli-row-action"
              type="button"
              :aria-label="`${scope.row.name} 操作`"
              @click="push(`已为 ${scope.row.name} 重新检测环境`)"
            >
              <AppIcon name="dots" :size="16" />
            </button>
          </template>
        </ElTableColumn>
      </ElTable>

      <div class="cli-panel-foot">
        <span class="foot-note">
          <AppIcon name="clock" :size="14" />
          {{ autoRefresh ? `下次自动扫描：${interval}内` : '定时刷新已关闭' }}
        </span>
        <button type="button" @click="startScan">重新扫描</button>
      </div>
    </section>
  </div>
</template>
