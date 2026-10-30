<script setup lang="ts">
import { useToast } from '../../composables/useToast'
import AppIcon from '../icons/AppIcon.vue'

const { toasts } = useToast()
</script>

<template>
  <div class="toast-area" aria-live="polite">
    <div v-for="toast in toasts" :key="toast.id" class="toast">
      <span><AppIcon name="check" :size="11" /></span>
      {{ toast.message }}
    </div>
  </div>
</template>
