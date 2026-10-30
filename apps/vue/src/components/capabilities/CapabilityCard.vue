<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Capability } from '../../mocks/types'
import { MCP_TRANSPORT_LABELS } from '../../mocks/types'
import AppIcon from '../icons/AppIcon.vue'

defineProps<{
  cap: Capability
}>()

const emit = defineEmits<{
  toggle: []
  detail: []
  edit: []
  duplicate: []
  remove: []
}>()

const menuOpen = ref(false)
const menuHost = ref<HTMLElement | null>(null)

const onDocClick = (event: MouseEvent) => {
  if (menuOpen.value && menuHost.value && !menuHost.value.contains(event.target as Node)) {
    menuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const MENU_ACTIONS = [
  { label: '查看详情', action: 'detail', icon: 'search' },
  { label: '编辑', action: 'edit', icon: 'edit' },
  { label: '创建副本', action: 'duplicate', icon: 'copy' },
  { label: '删除', action: 'remove', icon: 'trash' },
] as const

const onMenuAction = (action: (typeof MENU_ACTIONS)[number]['action']) => {
  menuOpen.value = false
  if (action === 'detail') {
    emit('detail')
    return
  }
  if (action === 'edit') {
    emit('edit')
    return
  }
  if (action === 'duplicate') {
    emit('duplicate')
    return
  }
  emit('remove')
}
</script>

<template>
  <article class="capability-card" :class="{ disabled: !cap.enabled }" @click="emit('detail')">
    <div class="card-head">
      <span class="capability-icon" :class="cap.iconColor">
        <AppIcon :name="cap.icon" :size="22" />
      </span>
      <div class="card-actions">
        <button
          class="toggle"
          :class="{ 'is-on': cap.enabled }"
          type="button"
          role="switch"
          :aria-checked="cap.enabled"
          :aria-label="(cap.enabled ? '停用 ' : '启用 ') + cap.name"
          @click.stop="emit('toggle')"
        >
          <span />
        </button>
        <div ref="menuHost" class="icon-host">
          <button
            class="more-button"
            type="button"
            :aria-label="cap.name + ' 更多操作'"
            @click.stop="menuOpen = !menuOpen"
          >
            <AppIcon name="dots" :size="18" />
          </button>
          <div v-if="menuOpen" class="menu-panel card-menu" @click.stop>
            <template v-for="item in MENU_ACTIONS" :key="item.action">
              <div v-if="item.action === 'remove'" class="menu-divider" />
              <button
                class="menu-row"
                :class="{ danger: item.action === 'remove' }"
                type="button"
                @click="onMenuAction(item.action)"
              >
                <AppIcon :name="item.icon" :size="15" />
                {{ item.label }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
    <div class="card-title-row">
      <strong>{{ cap.name }}</strong>
      <span v-if="cap.badge" class="badge" :class="{ beta: cap.badge.tone === 'beta' }">
        {{ cap.badge.text }}
      </span>
    </div>
    <p>{{ cap.description }}</p>
    <div class="card-footer">
      <span class="footer-tags">
        <span class="category-tag">{{ cap.category }}</span>
      </span>
      <span v-if="cap.kind === 'mcp' && cap.transport" class="meta">
        {{ MCP_TRANSPORT_LABELS[cap.transport] }}
      </span>
      <span v-else class="meta">更新于 {{ cap.updatedAt }}</span>
    </div>
  </article>
</template>
