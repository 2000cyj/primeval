<script setup lang="ts">
import { h } from 'vue'
import { NButton, NDropdown, NIcon, type DropdownOption } from 'naive-ui'
import { Info, MoreHorizontal, RefreshCw } from 'lucide-vue-next'

export type CliMenuAction = 'detail' | 'copy-path' | 'reinstall'

const props = defineProps<{ agentName: string }>()
const emit = defineEmits<{ action: [action: CliMenuAction, agentName: string] }>()

const options: DropdownOption[] = [
  { label: '查看详情', key: 'detail', icon: () => h(Info, { size: 14 }) },
  { label: '复制路径', key: 'copy-path', icon: () => h(RefreshCw, { size: 14 }) },
  { label: '重新安装', key: 'reinstall', icon: () => h(RefreshCw, { size: 14 }) },
]

const onSelect = (key: string) => {
  emit('action', key as CliMenuAction, props.agentName)
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
