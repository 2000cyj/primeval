<template>
  <el-input
    v-model="text"
    type="textarea"
    :rows="rows"
    :placeholder="placeholder"
    @input="handleInput"
    @blur="handleBlur"
  />
  <div v-if="errorMessage" style="margin-top: 4px; color: var(--el-color-danger); font-size: 12px">
    {{ errorMessage }}
  </div>
</template>

<script setup lang="ts" name="JsonEditor">
// 迁自 app，显式 import ref/watch 以脱离 unplugin-auto-import 独立编译。
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [Object, Array, String], default: () => ({}) },
  rows: { type: Number, default: 10 },
  placeholder: { type: String, default: '请输入 JSON' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const text = ref('')
const errorMessage = ref('')

function sync(val: any) {
  try {
    text.value = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
  } catch {
    text.value = String(val ?? '')
  }
}

watch(() => props.modelValue, sync, { immediate: true })

function handleInput(val: string) {
  errorMessage.value = ''
  text.value = val
}

function handleBlur() {
  if (!text.value.trim()) {
    emit('update:modelValue', '')
    emit('change', '')
    return
  }
  try {
    const parsed = JSON.parse(text.value)
    emit('update:modelValue', parsed)
    emit('change', parsed)
    errorMessage.value = ''
  } catch (e: any) {
    errorMessage.value = `JSON 格式错误：${e.message}`
  }
}
</script>
