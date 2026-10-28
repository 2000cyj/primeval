<script setup lang="ts">
// 占位根组件:后续替换为真实应用界面
defineOptions({ name: 'TheApp' })

const pkg = '@remote/app-vue'
</script>

<template>
  <div class="app">
    <h1>{{ pkg }}</h1>
    <p>Vite + Vue 3 + TypeScript 占位应用</p>
  </div>
</template>

<style scoped>
.app {
  font-family: system-ui, sans-serif;
  text-align: center;
  margin-top: 2rem;
}
</style>
