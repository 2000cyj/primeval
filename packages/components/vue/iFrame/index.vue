<template>
  <div v-loading="loading" :style="'height:' + height">
    <iframe :src="url" frameborder="no" style="width: 100%; height: 100%" scrolling="auto" />
  </div>
</template>

<script setup lang="ts" name="IFrame">
// 迁自 app，显式 import ref/computed/onMounted 以脱离 unplugin-auto-import 独立编译。
// v-loading 指令由消费方（app）全局注册的 ElementPlus 提供。
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  src: {
    type: String,
    required: true,
  },
})

const height = ref<string>(document.documentElement.clientHeight - 94.5 + 'px;')
const loading = ref<boolean>(true)
const url = computed(() => props.src)

onMounted(() => {
  setTimeout(() => {
    loading.value = false
  }, 300)
  window.onresize = function temp(): void {
    height.value = document.documentElement.clientHeight - 94.5 + 'px;'
  }
})
</script>
