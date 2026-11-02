<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppSidebar from './components/layout/AppSidebar.vue'
import AppTopbar from './components/layout/AppTopbar.vue'
import ToastHost from './components/layout/ToastHost.vue'
</script>

<template>
  <div class="app-shell">
    <AppSidebar />
    <main class="main-content">
      <AppTopbar />
      <RouterView />
    </main>
    <ToastHost />
  </div>
</template>
