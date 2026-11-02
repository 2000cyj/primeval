<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useUiState } from '../../composables/useUiState'
import { initialNotifications } from '../../mocks/notifications'
import type { NotificationItem } from '../../mocks/types'
import AppIcon from '../icons/AppIcon.vue'
import NotificationCenter from './NotificationCenter.vue'
import HelpCenterModal from './HelpCenterModal.vue'

const route = useRoute()
const { ui } = useUiState()

const crumbs = computed<string[]>(() => {
  const base = (route.meta.crumb as string | undefined) ?? ''
  const tail = ui.crumbTail || (route.meta.crumbTail as string | undefined) || ''
  return tail ? [base, tail] : [base]
})

// 通知状态提升到顶栏层，铃铛未读小红点与面板联动
const notifications = ref<NotificationItem[]>([...initialNotifications])
const panelOpen = ref(false)
const helpOpen = ref(false)

const hasUnread = computed(() => notifications.value.some((item) => item.unread))

const markAllRead = () => {
  notifications.value = notifications.value.map((item) => ({ ...item, unread: false }))
}

const closePanel = () => {
  panelOpen.value = false
}
</script>

<template>
  <header class="topbar">
    <nav class="breadcrumbs" aria-label="面包屑">
      <template v-for="(crumb, index) in crumbs" :key="crumb">
        <span v-if="index > 0"><AppIcon name="chevron" :size="14" /></span>
        <strong v-if="index === crumbs.length - 1">{{ crumb }}</strong>
        <span v-else>{{ crumb }}</span>
      </template>
    </nav>
    <div class="top-actions">
      <button class="help-button" type="button" aria-label="帮助中心" @click="helpOpen = true">
        ?
      </button>
      <NotificationCenter
        :open="panelOpen"
        :notifications="notifications"
        :has-unread="hasUnread"
        @toggle="panelOpen = !panelOpen"
        @close="closePanel"
        @mark-all-read="markAllRead"
      />
    </div>
    <HelpCenterModal :open="helpOpen" @close="helpOpen = false" />
  </header>
</template>
