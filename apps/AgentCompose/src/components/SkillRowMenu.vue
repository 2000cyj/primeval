<script setup lang="ts">
import { h } from 'vue'
import { NButton, NDropdown, NIcon, type DropdownOption } from 'naive-ui'
import { Copy, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-vue-next'

export type SkillMenuAction = 'detail' | 'edit' | 'duplicate' | 'delete'

const props = defineProps<{ skillName: string }>()
const emit = defineEmits<{ action: [action: SkillMenuAction, skillName: string] }>()

const options: DropdownOption[] = [
  { label: '查看详情', key: 'detail', icon: () => h(FileText, { size: 14 }) },
  { label: '编辑', key: 'edit', icon: () => h(Pencil, { size: 14 }) },
  { label: '创建副本', key: 'duplicate', icon: () => h(Copy, { size: 14 }) },
  {
    label: '删除',
    key: 'delete',
    icon: () => h(Trash2, { size: 14, color: 'var(--c-danger)' }),
    props: { style: 'color: var(--c-danger)' },
  },
]

const onSelect = (key: string) => {
  emit('action', key as SkillMenuAction, props.skillName)
}
</script>

<template>
  <NDropdown trigger="click" :options="options" placement="bottom-end" @select="onSelect">
    <NButton quaternary circle size="tiny" :aria-label="`${props.skillName} 更多操作`">
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
