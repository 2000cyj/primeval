<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="width"
    :fullscreen="fullscreen"
    :destroy-on-close="destroyOnClose"
    :append-to-body="appendToBody"
    :close-on-click-modal="closeOnClickModal"
    @close="handleClose"
  >
    <div :style="bodyStyle">
      <slot></slot>
    </div>
    <template v-if="$slots.footer" #footer>
      <slot name="footer"></slot>
    </template>
  </el-dialog>
</template>

<script setup lang="ts" name="Dialog">
// 迁自 app，显式 import computed 以脱离 unplugin-auto-import 独立编译。
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: [String, Number], default: '600px' },
  fullscreen: { type: Boolean, default: false },
  destroyOnClose: { type: Boolean, default: true },
  appendToBody: { type: Boolean, default: true },
  closeOnClickModal: { type: Boolean, default: false },
  bodyStyle: { type: Object, default: () => ({ padding: '10px 20px' }) },
})

const emit = defineEmits(['update:modelValue', 'close'])

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function handleClose() {
  emit('close')
}
</script>
