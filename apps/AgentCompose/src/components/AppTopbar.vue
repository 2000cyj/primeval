<script setup lang="ts">
import { NButton, NIcon, NTooltip, useMessage } from 'naive-ui'
import { Bell, CircleHelp } from 'lucide-vue-next'

const message = useMessage()
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

    <NTooltip trigger="hover">
      <template #trigger>
        <NButton
          quaternary
          circle
          size="small"
          aria-label="通知"
          @click="message.info('没有新通知')"
        >
          <NIcon :size="16">
            <Bell />
          </NIcon>
        </NButton>
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
</style>
