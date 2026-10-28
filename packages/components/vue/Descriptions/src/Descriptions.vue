<template>
  <div class="descriptions-wrap">
    <el-descriptions
      :title="title"
      :column="column"
      :border="border"
      :size="size"
      :direction="direction"
    >
      <template v-if="$slots.title" #title>
        <slot name="title"></slot>
      </template>
      <template v-if="$slots.extra" #extra>
        <slot name="extra"></slot>
      </template>
      <slot></slot>
    </el-descriptions>
  </div>
</template>

<script setup lang="ts" name="Descriptions">
// 迁自 app，显式 import PropType 以脱离 unplugin-auto-import 独立编译。
import type { PropType } from 'vue'

defineProps({
  title: { type: String, default: '' },
  column: { type: Number, default: 2 },
  border: { type: Boolean, default: true },
  size: { type: String as PropType<'large' | 'default' | 'small'>, default: 'default' },
  direction: {
    type: String as PropType<'horizontal' | 'vertical'>,
    default: 'horizontal',
  },
})
</script>
