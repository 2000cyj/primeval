<script setup lang="ts">
import { NButton, NIcon, NPopover } from 'naive-ui'
import { MoreHorizontal, Trash2 } from 'lucide-vue-next'

/** 行内菜单的动作 */
export type CliMenuAction = 'uninstall'

const props = defineProps<{ agentName: string; command: string }>()
const emit = defineEmits<{ action: [action: CliMenuAction, command: string] }>()

const onSelect = (action: CliMenuAction) => {
  emit('action', action, props.command)
}
</script>

<template>
  <NPopover trigger="click" placement="bottom-end" :width="140" :show-arrow="false">
    <template #trigger>
      <NButton quaternary circle size="tiny" :aria-label="`${props.agentName} 更多操作`">
        <template #icon>
          <NIcon :size="15">
            <MoreHorizontal />
          </NIcon>
        </template>
      </NButton>
    </template>

    <div class="menu">
      <!-- 卸载是破坏性的，标红 -->
      <button class="menu-item menu-item-danger" type="button" @click="onSelect('uninstall')">
        <NIcon :size="14">
          <Trash2 />
        </NIcon>
        卸载
      </button>
    </div>
  </NPopover>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--c-surface-sunken);
}

.menu-item-danger {
  color: var(--c-danger);
}

.menu-item-danger:hover {
  background: rgb(220 38 38 / 10%);
}
</style>
