<script setup lang="ts">
import { Bell } from 'lucide-vue-next'

const emit = defineEmits<{ notify: [message: string] }>()
</script>

<template>
  <header class="topbar">
    <button class="icon-button" aria-label="帮助中心" @click="emit('notify', '帮助中心')">?</button>
    <button class="icon-button" aria-label="通知" @click="emit('notify', '暂无新通知')">
      <Bell :size="16" aria-hidden="true" />
      <i class="dot" />
    </button>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  height: 64px;
  padding: 0 36px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(24px);
  border-bottom: 1px solid var(--color-border);
}

.icon-button {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  color: #555c6d;
  font-size: 13px;
  font-weight: 600;
}

.icon-button:hover {
  background: var(--color-bg);
}

.icon-button .dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border: 1px solid #fff;
  border-radius: 3px;
  background: var(--color-danger);
}

@media (max-width: 860px) {
  .topbar {
    padding: 0 16px;
  }
}
</style>
