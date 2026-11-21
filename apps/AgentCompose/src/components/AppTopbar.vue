<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NIcon, NPopover, NTooltip, useMessage } from 'naive-ui'
import { Bell, CircleAlert, CircleCheck, CircleHelp, Loader2, RefreshCw, X } from 'lucide-vue-next'
import { useNotifications } from '@/composables/useNotifications'
import { useWindowChrome } from '@/composables/useWindowChrome'
import { useHelpCenter } from '@/composables/useHelpCenter'
import { scanAgents, agentScanning } from '@/api/agents'
import { requestMcpReload } from '@/api/mcp'
import { requestSkillReload } from '@/api/skills'
import HelpModal from '@/components/HelpModal.vue'
import WindowControls from '@/components/WindowControls.vue'
import { formatDateTime } from '@/utils/datetime'

const { notices, runningCount, dismiss, clear } = useNotifications()

/** Windows 上没有系统标题栏，窗口按钮由我们画 */
const { enabled: customChrome } = useWindowChrome()

/**
 * 帮助弹窗开没开。
 *
 * 共享状态 —— 右下角更新提醒点开的时候也是开这个（见 `@/composables/useHelpCenter`）。
 */
const { helpOpen, openHelp } = useHelpCenter()

/** 消息提示 */
const message = useMessage()

/** 正在刷新工具箱 */
const refreshing = computed(() => agentScanning.value)

/**
 * 刷新工具箱 —— 重新探测本机装了哪些 CLI。
 *
 * 扫描结果放在模块级（`@/api/agents`）—— 侧边栏的计数、工具箱页面的
 * 列表、这里刷的，是同一份。所以在这儿刷完，切到工具箱页面看到的就是新的。
 *
 * **Skills / MCP 列表也一起刷** —— 顶栏的刷新是全局动作，
 * 不该只管 CLI 而放着别的不管（`requestSkillReload` / `requestMcpReload`
 * 各发一个信号，对应页面收到就重新拉）。
 */
const refreshToolbox = async (): Promise<void> => {
  if (refreshing.value) return
  try {
    await scanAgents()
    requestSkillReload()
    requestMcpReload()
    message.success('工具箱已刷新')
  } catch (error) {
    message.error(`刷新失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 角标上的数字：没有就不显示 */
const badge = computed(() => (notices.value.length > 99 ? '99+' : String(notices.value.length)))

/** 时间显示：统一走 utils/datetime，跟其它页面一致（YYYY-MM-DD HH:mm:ss） */
const timeText = (timestamp: number): string => formatDateTime(timestamp)
</script>

<template>
  <!--
    顶栏同时是窗口标题栏：Windows 上系统标题栏被去掉了，
    这一行就是标题栏，空白处可以拖动窗口（双击最大化由 Tauri 处理）。
    按钮是 <button>，Tauri 的拖拽判定会自动放过它们。
  -->
  <header class="topbar" data-tauri-drag-region="deep">
    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary circle size="small" aria-label="帮助" @click="openHelp()">
          <NIcon :size="16">
            <CircleHelp />
          </NIcon>
        </NButton>
      </template>
      帮助中心
    </NTooltip>

    <!--
      刷新工具箱 —— 重新探测本机装了哪些 CLI。
      放在帮助按钮旁边：两者都是「全局的、不属于当前页面」的操作。
    -->
    <NTooltip trigger="hover">
      <template #trigger>
        <NButton
          quaternary
          circle
          size="small"
          aria-label="刷新工具箱"
          :disabled="refreshing"
          @click="refreshToolbox"
        >
          <NIcon :size="16" :class="{ spin: refreshing }">
            <RefreshCw />
          </NIcon>
        </NButton>
      </template>
      刷新工具箱
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

    <HelpModal v-model:show="helpOpen" />

    <!-- 窗口按钮贴窗口右边：跟系统标题栏一个位置 -->
    <WindowControls v-if="customChrome" />
  </header>
</template>

<style scoped>
/*
 * 顶栏：不在滚动容器里（在 .content 上面），所以它天然固定 ——
 * 不需要 sticky。
 *
 * 之前是 sticky + 整页滚动，滚动条会穿过顶栏那 48px，看着像滑轮顶到了头部。
 * 现在滚动交给 .content，滚动条只在顶栏下面。
 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex: none;
  height: var(--h-header);
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
  /* 滚动条留固定位置：出现/消失时内容宽度不跳 */
  scrollbar-gutter: stable vertical;
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
