<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { NButton, NDataTable, NIcon, NSelect, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { Download, RefreshCw } from 'lucide-vue-next'
import { cliAgents, type CliAgent } from '@/data/agents'
import CliRowMenu, { type CliMenuAction } from '@/components/CliRowMenu.vue'

const message = useMessage()

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

const onUpgrade = (agent: CliAgent) => {
  message.info(`升级 ${agent.name} 到 ${agent.latestVersion ?? ''}`)
}

const onRowAction = (action: CliMenuAction, agentName: string) => {
  if (action === 'copy-path') {
    const agent = cliAgents.find((item) => item.name === agentName)
    if (agent) copyPath(agent)
    return
  }
  const labels: Record<CliMenuAction, string> = {
    detail: '查看详情',
    'copy-path': '复制路径',
    reinstall: '重新安装',
  }
  message.info(`${labels[action]}：${agentName}`)
}

const copyPath = (agent: CliAgent) => {
  void navigator.clipboard?.writeText(agent.path)
  message.success('路径已复制')
}

const statusTag = (agent: CliAgent) =>
  agent.status === 'available'
    ? h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '可用' })
    : h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '需要登录' })

const columns: DataTableColumns<CliAgent> = [
  {
    title: 'agents',
    key: 'name',
    width: '44%',
    render: (agent) =>
      h('div', { class: 'cell-agent' }, [
        h('span', { class: 'cell-icon', style: { background: agent.iconBg } }, [
          h('img', { class: 'cell-icon-img', src: agent.icon, alt: agent.name }),
        ]),
        h('div', { class: 'cell-text' }, [
          h('span', { class: 'cell-title' }, agent.name),
          h(
            'button',
            {
              class: 'cell-path mono',
              type: 'button',
              title: '点击复制路径',
              onClick: () => copyPath(agent),
            },
            agent.path,
          ),
        ]),
      ]),
  },
  {
    title: '版本',
    key: 'version',
    width: '28%',
    render: (agent) =>
      h('div', { class: 'cell-version' }, [
        h('div', { class: 'cell-version-row' }, [
          h('span', { class: 'cell-mono tnum' }, agent.version),
          agent.latestVersion
            ? h(
                NButton,
                { size: 'tiny', secondary: true, onClick: () => onUpgrade(agent) },
                {
                  icon: () => h(NIcon, { size: 13 }, { default: () => h(Download) }),
                  default: () => '升级',
                },
              )
            : null,
        ]),
        agent.latestVersion
          ? h('span', { class: 'cell-new' }, [
              h('span', '有新版本 '),
              h('span', { class: 'cell-mono tnum' }, agent.latestVersion),
            ])
          : null,
      ]),
  },
  {
    title: '状态',
    key: 'status',
    width: '16%',
    render: statusTag,
  },
  {
    title: '',
    key: 'actions',
    width: '6%',
    align: 'right',
    render: (agent) =>
      h(CliRowMenu, {
        agentName: agent.name,
        onAction: (action: CliMenuAction, name: string) => onRowAction(action, name),
      }),
  },
]
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">agents</h1>
        <p class="page-sub">检测本机已安装的 CLI agents 及其版本</p>
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
          <NButton size="small" secondary @click="message.info('正在重新检测')">
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
          <span class="table-count tnum">{{ cliAgents.length }}</span>
          <span class="table-foot">下次检测：{{ nextScan }}后</span>
        </header>

        <NDataTable
          :columns="columns"
          :data="cliAgents"
          :row-key="(row: CliAgent) => row.id"
          :bordered="false"
          size="small"
        />
      </section>
    </div>
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
