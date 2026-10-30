<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import type { NotificationItem } from '../../mocks/types'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  open: boolean
  notifications: NotificationItem[]
  hasUnread: boolean
}>()

const emit = defineEmits<{
  toggle: []
  close: []
  'mark-all-read': []
}>()

const { push } = useToast()

const rootRef = ref<HTMLElement | null>(null)

const onDocClick = (event: MouseEvent) => {
  if (props.open && rootRef.value && !rootRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const markAll = () => {
  emit('mark-all-read')
  push('已全部标记为已读')
}

const viewAll = () => {
  push('已打开全部通知')
  emit('close')
}
</script>

<template>
  <div ref="rootRef" class="notification-wrap">
    <button
      class="notification-button"
      type="button"
      aria-label="通知"
      @click.stop="emit('toggle')"
    >
      <AppIcon name="bell" :size="17" />
      <i v-if="hasUnread" class="notification-dot" />
    </button>
    <section v-if="open" class="notification-panel" aria-label="通知中心">
      <div class="panel-head">
        <strong>通知</strong>
        <button type="button" :disabled="!hasUnread" @click="markAll">全部已读</button>
      </div>
      <button
        v-for="item in notifications"
        :key="item.id"
        class="notification-item"
        :class="{ unread: item.unread }"
        type="button"
      >
        <span class="notification-icon" :class="{ muted: item.id !== 'notif-db-recovered' }">
          <AppIcon :name="item.id === 'notif-db-recovered' ? 'server' : 'skill'" :size="17" />
        </span>
        <span class="body-row">
          <strong>{{ item.title }}</strong>
          <p>{{ item.body }}</p>
        </span>
        <span class="time">{{ item.time }}</span>
      </button>
      <div class="panel-foot">
        <button type="button" @click="viewAll">查看全部通知</button>
      </div>
    </section>
  </div>
</template>
