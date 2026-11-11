<script setup lang="ts">
import { h } from 'vue'
import { NButton, NDropdown, NIcon, type DropdownOption } from 'naive-ui'
import { Copy, MoreHorizontal, Terminal, Trash2 } from 'lucide-vue-next'

export type AgentRunMenuAction = 'copy' | 'copyCommand' | 'delete'

const props = defineProps<{ agentName: string }>()
const emit = defineEmits<{ action: [action: AgentRunMenuAction, agentName: string] }>()

const options: DropdownOption[] = [
  { label: '复制', key: 'copy', icon: () => h(Copy, { size: 14 }) },
  {
    label: '复制启动命令',
    key: 'copyCommand',
    icon: () => h(Terminal, { size: 14 }),
  },
  {
    label: '删除',
    key: 'delete',
    icon: () => h(Trash2, { size: 14, color: 'var(--c-danger)' }),
    props: { style: 'color: var(--c-danger)' },
  },
]

const onSelect = (key: string) => {
  emit('action', key as AgentRunMenuAction, props.agentName)
}
</script>

<template>
  <NDropdown trigger="click" :options="options" placement="bottom-end" @select="onSelect">
    <NButton quaternary circle size="tiny" :aria-label="`${props.agentName} 更多操作`">
      <template #icon>
        <NIcon :size="15">
          <MoreHorizontal />
        </NIcon>
      </template>
    </NButton>
  </NDropdown>
</template>

<style scoped>
:deep(.n-dropdown-option-body__label) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
</style>
