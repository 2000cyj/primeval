<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-vue-next'
import { cliAgents, type CliAgent } from '@/data/agents'
import { useToast } from '@/composables/useToast'

/** 定时刷新间隔选项 */
const REFRESH_OPTIONS = [
  { label: '15s', hint: '15 秒内' },
  { label: '30s', hint: '30 秒内' },
  { label: '1min', hint: '1 分钟内' },
  { label: '5min', hint: '5 分钟内' },
]

/** 状态徽章配色（可用 / 需要登录） */
const STATUS_META: Record<
  CliAgent['status'],
  { label: string; bg: string; dot: string; text: string }
> = {
  available: { label: '可用', bg: '#E8F8F1', dot: '#20A676', text: '#187957' },
  'login-required': { label: '需要登录', bg: '#FFF3DC', dot: '#D39234', text: '#9A651F' },
}

const refreshInterval = ref<string>('15s')
const { notify } = useToast()

const nextScanText = computed(() => {
  const option = REFRESH_OPTIONS.find((item) => item.label === refreshInterval.value)
  return `下次自动扫描：${option ? option.hint : '15 秒内'}`
})

const onRefreshNow = () => {
  notify(`正在重新扫描本地 CLI 安装状态（间隔 ${refreshInterval.value}）`)
}

const onUpgrade = (agent: CliAgent) => {
  notify(`开始升级 ${agent.name} 至 ${agent.latestVersion ?? ''}`)
}

const onExtraInstall = (agent: CliAgent) => {
  notify(`${agent.name} 存在其它安装位置`)
}

const onMore = (agent: CliAgent) => {
  notify(`${agent.name} 更多操作`)
}
</script>

<template>
  <section class="page">
    <!-- 定时刷新设置 -->
    <div class="refresh-card">
      <div class="refresh-main">
        <span class="refresh-icon"
          ><RefreshCw :size="19" :stroke-width="1.5" aria-hidden="true"
        /></span>
        <span class="refresh-copy">
          <strong>定时刷新</strong>
          <small>按设定间隔自动重新扫描本地 CLI 安装状态</small>
        </span>
      </div>

      <div class="refresh-actions">
        <span class="every-label">每</span>
        <span class="interval">
          <select v-model="refreshInterval" aria-label="刷新间隔">
            <option v-for="option in REFRESH_OPTIONS" :key="option.label" :value="option.label">
              {{ option.label }}
            </option>
          </select>
          <ChevronDown class="interval-chevron" :size="12" :stroke-width="1.5" aria-hidden="true" />
        </span>
        <button type="button" class="outline-button" @click="onRefreshNow">
          <RefreshCw :size="15" :stroke-width="1.2" aria-hidden="true" />立即刷新
        </button>
      </div>
    </div>

    <!-- 本地 CLI 列表 -->
    <div class="list-card">
      <header class="card-head">
        <div class="head-left">
          <strong>本地 CLI</strong>
          <span class="count-badge">共发现 {{ cliAgents.length }} 个</span>
        </div>
        <div class="head-right">
          <i class="service-dot" />
          <span>扫描服务正常</span>
        </div>
      </header>

      <div class="grid table-head">
        <span>智能体</span>
        <span>版本</span>
        <span>状态</span>
        <span />
      </div>

      <div v-for="agent in cliAgents" :key="agent.id" class="grid agent-row">
        <div class="agent-info">
          <span class="agent-icon" :style="{ background: agent.iconBg, color: agent.iconColor }">
            <component :is="agent.icon" :size="22" :stroke-width="1.5" />
          </span>
          <span class="agent-copy">
            <strong>{{ agent.name }}</strong>
            <span class="path-line">
              <span class="path">{{ agent.path }}</span>
              <button
                v-if="agent.extraInstall"
                class="extra-install"
                type="button"
                @click="onExtraInstall(agent)"
              >
                {{ agent.extraInstall
                }}<ChevronRight :size="13" :stroke-width="1" aria-hidden="true" />
              </button>
            </span>
          </span>
        </div>

        <div class="version-cell">
          <span class="version-stack">
            <span class="version">{{ agent.version }}</span>
            <span v-if="agent.latestVersion" class="version-new">
              有新版本 {{ agent.latestVersion }}
            </span>
          </span>
          <button
            v-if="agent.latestVersion"
            class="upgrade-button"
            type="button"
            @click="onUpgrade(agent)"
          >
            <Download :size="14" :stroke-width="1.1" aria-hidden="true" />升级
          </button>
        </div>

        <div>
          <span
            class="status-badge"
            :style="{
              background: STATUS_META[agent.status].bg,
              color: STATUS_META[agent.status].text,
            }"
          >
            <i :style="{ background: STATUS_META[agent.status].dot }" />{{
              STATUS_META[agent.status].label
            }}
          </span>
        </div>

        <button
          type="button"
          class="row-more"
          :aria-label="agent.name + ' 更多操作'"
          @click="onMore(agent)"
        >
          <MoreHorizontal :size="18" aria-hidden="true" />
        </button>
      </div>

      <footer class="card-foot">
        <Clock :size="14" :stroke-width="1.1" aria-hidden="true" />
        <span>{{ nextScanText }}</span>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.page {
  min-height: calc(100vh - 64px);
  padding: 24px 38px 60px;
  background: var(--color-bg);
}

/* 卡片一：定时刷新 */
.refresh-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 66px;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(17, 19, 24, 0.08);
}

.refresh-main {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.refresh-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: #eeecff;
  color: var(--color-primary);
}

.refresh-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.refresh-copy strong {
  font-size: 11px;
  font-weight: 700;
  line-height: 16.5px;
  color: var(--color-text);
}

.refresh-copy small {
  font-size: 9px;
  line-height: 13.5px;
  color: var(--color-text-muted);
}

.refresh-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}

.every-label {
  font-size: 10px;
  line-height: 15px;
  color: var(--color-text-weak);
}

.interval {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 75px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: #fff;
}

.interval select {
  width: 100%;
  height: 100%;
  padding: 0 22px 0 14px;
  border: 0;
  outline: 0;
  background: transparent;
  appearance: none;
  color: var(--color-text-secondary);
  font-size: 10px;
}

.interval-chevron {
  position: absolute;
  right: 5px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.outline-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: #fff;
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 600;
}

.outline-button:hover {
  border-color: var(--color-text-disabled);
  background: var(--color-surface-muted);
}

/* 卡片二：本地 CLI 列表 */
.list-card {
  margin-top: 14px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(17, 19, 24, 0.08);
  overflow: hidden;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 58px;
  padding: 0 18px;
  border-bottom: 1px solid var(--color-divider);
}

.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-left strong {
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
  color: var(--color-text);
}

.count-badge {
  padding: 2px 6px;
  border-radius: 9px;
  background: var(--color-divider);
  color: var(--color-text-weak);
  font-size: 8px;
  line-height: 12px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-weak);
  font-size: 9px;
  line-height: 13.5px;
}

.service-dot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: #27b982;
}

/* 设计稿栅格：499 / 233 / 171 / 28 */
.grid {
  display: grid;
  grid-template-columns: 499fr 233fr 171fr 28fr;
  align-items: center;
}

.table-head {
  height: 38px;
  padding: 0 18px;
  border-bottom: 1px solid var(--color-divider);
  background: #fbfbfc;
  color: var(--color-text-muted);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.255px;
}

.agent-row {
  min-height: 72px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--color-divider);
}

.agent-row:hover {
  background: var(--color-surface-muted);
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.agent-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 9px;
}

.agent-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.agent-copy strong {
  font-size: 11px;
  font-weight: 700;
  line-height: 16.5px;
  color: var(--color-text);
}

.path-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.path {
  font-size: 8.5px;
  line-height: 12.75px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.extra-install {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: #bc7b16;
  font-size: 8.5px;
  font-weight: 600;
  line-height: 12.75px;
  white-space: nowrap;
}

.extra-install:hover {
  text-decoration: underline;
}

.version-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.version-stack {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.version {
  font-family: 'Cousine', 'Courier New', monospace;
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
  color: var(--color-text);
}

.version-new {
  font-size: 8px;
  line-height: 12px;
  color: #4f72a6;
  white-space: nowrap;
}

.upgrade-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: none;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: #fff;
  color: var(--color-text-secondary);
  font-size: 9px;
  font-weight: 600;
}

.upgrade-button:hover {
  border-color: var(--color-text-disabled);
  background: var(--color-surface-muted);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 8.5px;
  line-height: 12.75px;
  white-space: nowrap;
}

.status-badge i {
  width: 5px;
  height: 5px;
  border-radius: 2.5px;
}

.row-more {
  display: grid;
  place-items: center;
  justify-self: end;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-strong);
}

.row-more:hover {
  background: #f1f0ff;
  color: #6555e9;
}

.card-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 18px;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font-size: 8.5px;
  line-height: 12.75px;
}

@media (max-width: 1080px) {
  .page {
    padding: 20px 20px 40px;
  }

  .grid {
    grid-template-columns: minmax(240px, 2fr) minmax(150px, 1fr) 110px 30px;
  }
}
</style>
