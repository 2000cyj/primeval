<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NIcon, NPopover, NTooltip, useMessage } from 'naive-ui'
import { Bell, CircleAlert, CircleCheck, CircleHelp, Loader2, X } from 'lucide-vue-next'
import { useNotifications } from '@/composables/useNotifications'

const message = useMessage()

const { notices, runningCount, dismiss, clear } = useNotifications()

/** 角标上的数字：没有就不显示 */
const badge = computed(() => (notices.value.length > 99 ? '99+' : String(notices.value.length)))

/** 时间显示：今天的只写时分，更早的补上日期 */
const timeText = (timestamp: number): string => {
  const date = new Date(timestamp)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay ? `${hh}:${mm}` : `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`
}
</script>

<template>
  <header class="topbar">
    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary circle size="small" aria-label="帮助" @click="message.info('帮助中心')">
          <NIcon :size="16">
            <CircleHelp />
          </NIcon>
        </NButton>
      </template>
      帮助中心
    </NTooltip>

    <!-- 铃铛：悬停给个「通知」提示，点击展开通知面板 -->
    <!--
      NTooltip 套 NPopover：naive-ui 认 `__popover__` 标记，
      会把事件处理器通过 `internalInheritedEventHandlers` 传给内层，
      所以悬停提示和点击展开能共存。
    -->
    <NTooltip trigger="hover">
      <template #trigger>
        <NPopover trigger="click" placement="bottom-end" :width="340" :show-arrow="false">
          <template #trigger>
            <NButton quaternary circle size="small" aria-label="通知" class="bell">
              <NIcon :size="16">
                <Bell />
              </NIcon>
              <span v-if="notices.length" class="badge tnum">{{ badge }}</span>
            </NButton>
          </template>

          <div class="panel">
            <header class="panel-head">
              <span class="panel-title">
                通知
                <span v-if="runningCount" class="panel-running">{{ runningCount }} 项进行中</span>
              </span>
              <NButton v-if="notices.length" text size="tiny" @click="clear">清空</NButton>
            </header>

            <p v-if="!notices.length" class="panel-empty">暂无通知</p>

            <ul v-else class="panel-list">
              <li v-for="item in notices" :key="item.id" class="panel-item">
                <NIcon :size="14" class="item-icon" :class="item.status">
                  <Loader2 v-if="item.status === 'running'" class="spin" />
                  <CircleCheck v-else-if="item.status === 'success'" />
                  <CircleAlert v-else />
                </NIcon>
                <div class="item-body">
                  <span class="item-title">{{ item.title }}</span>
                  <span v-if="item.detail" class="item-detail">{{ item.detail }}</span>
                  <div class="item-foot">
                    <span class="item-time">{{ timeText(item.updatedAt) }}</span>
                    <button
                      v-if="item.action"
                      type="button"
                      class="item-action"
                      @click="item.action.run()"
                    >
                      {{ item.action.label }}
                    </button>
                  </div>
                </div>
                <button
                  class="item-close"
                  type="button"
                  aria-label="关闭通知"
                  @click="dismiss(item.id)"
                >
                  <NIcon :size="13">
                    <X />
                  </NIcon>
                </button>
              </li>
            </ul>
          </div>
        </NPopover>
      </template>
      通知
    </NTooltip>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  height: 48px;
  padding: 0 16px 0 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}

/* 铃铛 + 角标 */
.bell {
  position: relative;
}

.badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--c-accent);
  font-size: 10px;
  line-height: 15px;
  color: #fff;
  text-align: center;
}

/* 通知面板 */
.panel {
  display: flex;
  flex-direction: column;
  max-height: 360px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--c-border);
}

.panel-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.panel-running {
  font-size: 11px;
  font-weight: 400;
  color: var(--c-text-3);
}

.panel-empty {
  margin: 0;
  padding: 24px 0;
  font-size: 12px;
  color: var(--c-text-4);
  text-align: center;
}

.panel-list {
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.panel-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-border);
}

.panel-item:last-child {
  border-bottom: none;
}

.item-icon {
  flex: none;
  margin-top: 2px;
}

.item-icon.running {
  color: var(--c-accent);
}

.item-icon.success {
  color: var(--c-success);
}

.item-icon.error {
  color: var(--c-danger);
}

.item-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-title {
  font-size: 12px;
  font-weight: 500;
}

.item-detail {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-3);
  word-break: break-all;
}

.item-time {
  font-size: 10px;
  color: var(--c-text-4);
}

.item-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-action {
  padding: 0;
  font-size: 11px;
  color: var(--c-accent);
  cursor: pointer;
  background: none;
  border: none;
}

.item-action:hover {
  text-decoration: underline;
}

.item-close {
  flex: none;
  padding: 2px;
  color: var(--c-text-4);
  cursor: pointer;
  background: none;
  border: none;
}

.item-close:hover {
  color: var(--c-text-2);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
