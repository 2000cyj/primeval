<script setup lang="ts">
/**
 * 更新提醒的挂载点。
 *
 * 单独一个组件是因为 `useNotification()` 靠 inject 拿 API ——
 * 必须是 `NNotificationProvider` 的后代才能拿到。
 * App.vue 自己正好是 provider 的父级，在那儿调会拿不到。
 *
 * 这个组件什么都不渲染，只负责在启动时查一次更新。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useUpdateNotifier } from '@/composables/useUpdateNotifier'

const { init, dispose } = useUpdateNotifier()

onMounted(() => {
  init()
})

onBeforeUnmount(() => {
  dispose()
})
</script>

<template>
  <!--
    什么都不渲染 —— 但模板得有个根元素（vue/valid-template-root）。
    hidden 一下，不占地方也不显示。
  -->
  <span hidden />
</template>
