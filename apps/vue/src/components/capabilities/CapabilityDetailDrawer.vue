<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../icons/AppIcon.vue'
import type { Capability } from '../../mocks/types'
import { CAPABILITY_KIND_LABELS, MCP_TRANSPORT_LABELS } from '../../mocks/types'
import { workspaceStats } from '../../mocks/workspaceStats'
import { useCapabilities } from '../../composables/useCapabilities'

const props = defineProps<{
  capability: Capability | null
}>()

const visible = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  edit: []
  remove: []
}>()

const { setEnabled } = useCapabilities()

const cap = computed(() => props.capability)

/** 能力类型：Skill → Agent Skill，MCP → MCP Server */
const kindLabel = computed(() => (cap.value ? CAPABILITY_KIND_LABELS[cap.value.kind] : ''))

/** 连接方式：仅 MCP 有（实测原型：Skill 抽屉没有「连接方式」这一行） */
const transportLabel = computed(() => {
  if (!cap.value) return ''
  return cap.value.transport ? MCP_TRANSPORT_LABELS[cap.value.transport] : ''
})

const onToggle = () => {
  const target = cap.value
  if (!target) return
  setEnabled(target, !target.enabled)
}
</script>

<template>
  <div v-if="cap && visible" class="drawer-layer" @click.self="visible = false">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="能力详情">
      <div class="drawer-head">
        <span>能力详情</span>
        <button class="modal-close" type="button" aria-label="关闭" @click="visible = false">
          <AppIcon name="x" :size="19" />
        </button>
      </div>

      <div class="drawer-id">
        <span class="capability-icon" :class="cap.iconColor">
          <AppIcon :name="cap.icon" :size="26" />
        </span>
        <div class="copy">
          <strong>{{ cap.name }}</strong>
          <span>{{ cap.category }}</span>
        </div>
        <button
          class="toggle drawer-toggle"
          :class="{ 'is-on': cap.enabled }"
          type="button"
          role="switch"
          :aria-checked="cap.enabled"
          :aria-label="(cap.enabled ? '停用 ' : '启用 ') + cap.name"
          @click="onToggle"
        >
          <span />
        </button>
      </div>

      <div class="drawer-section">
        <span class="section-label">能力描述</span>
        <p>{{ cap.description }}</p>
      </div>

      <div class="drawer-fields">
        <div class="drawer-row">
          <span>当前状态</span>
          <strong :class="{ success: cap.enabled }">{{ cap.statusLabel }}</strong>
        </div>
        <div class="drawer-row">
          <span>能力类型</span>
          <strong>{{ kindLabel }}</strong>
        </div>
        <div v-if="cap.kind === 'mcp' && transportLabel" class="drawer-row">
          <span>连接方式</span>
          <strong>{{ transportLabel }}</strong>
        </div>
        <div v-else-if="cap.updatedAt" class="drawer-row">
          <span>最近更新</span>
          <strong>{{ cap.updatedAt }}</strong>
        </div>
        <div class="drawer-row">
          <span>权限范围</span>
          <strong>当前工作区</strong>
        </div>
      </div>

      <div class="drawer-section">
        <span class="section-label">最近调用</span>
        <div class="usage-chart">
          <i v-for="(value, index) in cap.usage" :key="index" :style="{ height: `${value}%` }" />
        </div>
        <div class="usage-foot">
          <span>{{ workspaceStats.period }}</span>
          <strong>{{ cap.calls.toLocaleString() }} 次调用</strong>
        </div>
      </div>

      <div class="drawer-foot">
        <button class="secondary-button danger-text" type="button" @click="emit('remove')">
          <AppIcon name="trash" :size="15" />
          删除
        </button>
        <button class="primary-button" type="button" @click="emit('edit')">
          <AppIcon name="edit" :size="15" />
          编辑配置
        </button>
      </div>
    </aside>
  </div>
</template>
