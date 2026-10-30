<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useToast } from '../../composables/useToast'
import { agentCount, currentWorkspace, sessionUser } from '../../mocks/session'
import AppIcon from '../icons/AppIcon.vue'

const route = useRoute()
const { push } = useToast()

// 主导航分组：工作台（能力中心 / 智能体）；系统设置独立放在侧栏底部
// 「智能体」指向本地 CLI 智能体页（实测原型里侧栏只有这一个智能体入口）
const navItems = [
  { label: '能力中心', to: '/', icon: 'skill', count: 0 },
  { label: '智能体', to: '/cli', icon: 'agent', count: agentCount },
] as const

const footerItems = [{ label: '系统设置', to: '/settings', icon: 'settings' }] as const

const isNavActive = (to: string) => route.path === to

const menuRoot = ref<HTMLElement | null>(null)
const wsMenuOpen = ref(false)
const userMenuOpen = ref(false)

const onDocClick = (event: MouseEvent) => {
  if (menuRoot.value && !menuRoot.value.contains(event.target as Node)) {
    wsMenuOpen.value = false
    userMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const toggleWorkspaceMenu = () => {
  wsMenuOpen.value = !wsMenuOpen.value
  userMenuOpen.value = false
}

const toggleUserMenu = () => {
  userMenuOpen.value = !userMenuOpen.value
  wsMenuOpen.value = false
}

const createWorkspace = () => {
  push('已进入创建工作区流程')
  wsMenuOpen.value = false
}

const userActions = [
  { label: '个人资料', toast: '个人资料面板已打开', danger: false },
  { label: '账号偏好', toast: '账号偏好已打开', danger: false },
  { label: '退出登录', toast: '演示环境不会退出登录', danger: true },
] as const

const onUserAction = (action: (typeof userActions)[number]) => {
  push(action.toast)
  userMenuOpen.value = false
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">
        <AppIcon name="agent" :size="22" />
      </div>
      <span>AgentSpace</span>
    </div>

    <div ref="menuRoot" class="workspace-host">
      <button
        class="workspace-switcher"
        type="button"
        :aria-expanded="wsMenuOpen"
        aria-label="切换工作区"
        @click.stop="toggleWorkspaceMenu"
      >
        <span class="workspace-avatar">{{ currentWorkspace.avatar }}</span>
        <span class="workspace-copy">
          <strong>{{ currentWorkspace.name }}</strong>
          <span>{{ currentWorkspace.subtitle }}</span>
        </span>
        <AppIcon class="ws-chevron" name="chevron" :size="16" />
      </button>
      <div v-if="wsMenuOpen" class="menu-panel ws-menu">
        <span class="menu-label">切换工作区</span>
        <button class="menu-row selected" type="button">
          <span class="mini-avatar">{{ currentWorkspace.avatar }}</span>
          {{ currentWorkspace.name }}
          <AppIcon class="spacer" name="check" :size="15" />
        </button>
        <button class="menu-row" type="button" @click="createWorkspace">
          <span class="mini-avatar muted"><AppIcon name="plus" :size="13" /></span>
          创建新工作区
        </button>
      </div>
    </div>

    <nav class="main-nav" aria-label="主导航">
      <span class="nav-label">工作台</span>
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        class="nav-item"
        :class="{ active: isNavActive(item.to) }"
        :to="item.to"
      >
        <AppIcon :name="item.icon" :size="19" />
        <span>{{ item.label }}</span>
        <span v-if="item.count" class="nav-count neutral">{{ item.count }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-bottom">
      <nav class="main-nav" aria-label="次级导航">
        <RouterLink
          v-for="item in footerItems"
          :key="item.to"
          class="nav-item"
          :class="{ active: isNavActive(item.to) }"
          :to="item.to"
        >
          <AppIcon :name="item.icon" :size="19" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="user-card">
        <span class="avatar">{{ sessionUser.avatar }}</span>
        <span class="user-copy">
          <strong>{{ sessionUser.name }}</strong>
          <span>{{ sessionUser.role }}</span>
        </span>
        <button
          class="icon-plain"
          type="button"
          aria-label="用户菜单"
          :aria-expanded="userMenuOpen"
          @click.stop="toggleUserMenu"
        >
          <AppIcon name="dots" :size="18" />
        </button>
        <div v-if="userMenuOpen" class="menu-panel">
          <button
            v-for="action in userActions"
            :key="action.label"
            class="menu-row"
            :class="{ danger: action.danger }"
            type="button"
            @click="onUserAction(action)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
