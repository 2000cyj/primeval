<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppIcon from '../icons/AppIcon.vue'
import type { Capability } from '../../mocks/types'

const visible = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  confirm: []
}>()

defineProps<{
  capability?: Capability | null
}>()

const onEsc = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && visible.value) visible.value = false
}

onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

const onConfirm = () => {
  emit('confirm')
  visible.value = false
}
</script>

<template>
  <div v-if="visible" class="overlay" role="presentation" @click.self="visible = false">
    <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-label="删除确认">
      <span class="danger-icon"><AppIcon name="trash" :size="22" /></span>
      <strong>删除“{{ capability?.name }}”？</strong>
      <p>删除后，所有关联智能体将无法继续调用此能力。此操作无法撤销。</p>
      <div class="modal-actions">
        <button class="secondary-button" type="button" @click="visible = false">取消</button>
        <button class="delete-button" type="button" @click="onConfirm">确认删除</button>
      </div>
    </section>
  </div>
</template>
