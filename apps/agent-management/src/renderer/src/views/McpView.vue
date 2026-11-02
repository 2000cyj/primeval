<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElEmpty, ElInput, ElOption, ElSelect } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import AppIcon from '../components/icons/AppIcon.vue'
import CapabilityCard from '../components/capabilities/CapabilityCard.vue'
import CapabilityDetailDrawer from '../components/capabilities/CapabilityDetailDrawer.vue'
import McpDialog from '../components/capabilities/McpDialog.vue'
import DeleteConfirmDialog from '../components/capabilities/DeleteConfirmDialog.vue'
import { useCapabilities } from '../composables/useCapabilities'
import { useToast } from '../composables/useToast'
import type { Capability } from '../mocks/types'
import { workspaceStats } from '../mocks/workspaceStats'

const { push } = useToast()
const { mcps, remove, toggle } = useCapabilities()

const keyword = ref('')
const statusFilter = ref('')
const mcpDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const detailOpen = ref(false)
const editingMcp = ref<Capability | null>(null)
const deleteTarget = ref<Capability | null>(null)
const detailTarget = ref<Capability | null>(null)

const STATUS_OPTIONS = [
  { label: '运行中', value: '运行中' },
  { label: '已停用', value: '已停用' },
]

const connectedCount = computed(() => mcps.value.filter((item) => item.enabled).length)
const pendingCount = computed(() => mcps.value.filter((item) => !item.enabled).length)
// 工作区级汇总口径：与能力中心统计卡同源，避免两页出现不同数字
const monthlyCalls = workspaceStats.monthlyCalls
const monthlyCallsDelta = workspaceStats.monthlyCallsDelta

const filteredList = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  return mcps.value.filter((item) => {
    const matchKey =
      !key || item.name.toLowerCase().includes(key) || item.description.toLowerCase().includes(key)
    const matchStatus = !statusFilter.value || item.statusLabel === statusFilter.value
    return matchKey && matchStatus
  })
})

const onToggle = (cap: Capability) => {
  toggle(cap)
}

const onEdit = (cap: Capability) => {
  editingMcp.value = cap
  mcpDialogOpen.value = true
}

const openDetail = (cap: Capability) => {
  detailTarget.value = cap
  detailOpen.value = true
}

const onDuplicate = (cap: Capability) => {
  push(`已创建副本：${cap.name}`)
}

const onRemove = (cap: Capability) => {
  deleteTarget.value = cap
  deleteDialogOpen.value = true
}

const onDrawerEdit = () => {
  if (detailTarget.value) onEdit(detailTarget.value)
}

const onDrawerRemove = () => {
  if (detailTarget.value) onRemove(detailTarget.value)
}

const confirmRemove = () => {
  const target = deleteTarget.value
  if (!target) return
  remove(target.id)
  push('已删除该能力')
}

const onSubmit = (payload: { name: string; description: string; category: string }) => {
  const target = editingMcp.value
  if (target) {
    target.name = payload.name
    target.description = payload.description
    target.category = payload.category
    push('修改已保存')
    return
  }
  mcps.value = [
    {
      id: `mcp-${mcps.value.length + 1}`,
      kind: 'mcp',
      name: payload.name,
      description: payload.description,
      category: payload.category,
      icon: 'plug',
      iconColor: 'cyan',
      enabled: true,
      statusLabel: '运行中',
      transport: 'HTTP 连接',
      usage: [...(mcps.value[0]?.usage ?? [])],
      calls: 0,
    },
    ...mcps.value,
  ]
  push('MCP 服务连接成功')
}
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">MCP SERVICES</div>
        <h1 class="title">MCP 服务</h1>
        <p>连接并管理智能体可调用的外部服务，保存后会自动完成一次连通性测试。</p>
      </div>
      <div class="heading-actions">
        <ElButton type="primary" @click="mcpDialogOpen = true">
          <Plus />
          连接 MCP 服务
        </ElButton>
      </div>
    </header>

    <section class="summary-row cols-4">
      <div class="summary-card featured">
        <span class="summary-icon"><AppIcon name="plug" :size="20" /></span>
        <span class="copy">
          <span>服务总数</span>
          <strong>{{ mcps.length }}</strong>
        </span>
        <em>当前工作区</em>
      </div>
      <div class="summary-card">
        <span class="summary-icon green"><AppIcon name="check" :size="20" /></span>
        <span class="copy">
          <span>运行中</span>
          <strong>{{ connectedCount }}</strong>
        </span>
        <em>个服务可用</em>
      </div>
      <div class="summary-card">
        <span class="summary-icon purple"><AppIcon name="clock" :size="20" /></span>
        <span class="copy">
          <span>已停用</span>
          <strong>{{ pendingCount }}</strong>
        </span>
        <em>需要补全配置</em>
      </div>
      <div class="summary-card">
        <span class="summary-icon green"><AppIcon name="trending-up" :size="20" /></span>
        <span class="copy">
          <span>本月调用</span>
          <strong>{{ monthlyCalls }}</strong>
        </span>
        <em class="positive">{{ monthlyCallsDelta }}</em>
      </div>
    </section>

    <section class="manager-panel">
      <div class="panel-top">
        <div class="tabs">
          <button type="button" class="active">
            全部服务
            <span class="tab-count">{{ mcps.length }}</span>
          </button>
        </div>
        <div class="panel-status">
          <span class="status-dot" />
          {{ connectedCount }} 个服务运行中
        </div>
      </div>

      <div class="toolbar">
        <ElInput v-model="keyword" placeholder="搜索 MCP 服务" clearable>
          <template #prefix>
            <Search />
          </template>
        </ElInput>
        <ElSelect v-model="statusFilter" placeholder="全部状态" clearable class="filter-select">
          <ElOption
            v-for="item in STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </ElSelect>
      </div>

      <div v-if="filteredList.length" class="card-grid">
        <CapabilityCard
          v-for="cap in filteredList"
          :key="cap.id"
          :cap="cap"
          @toggle="onToggle(cap)"
          @detail="openDetail(cap)"
          @edit="onEdit(cap)"
          @duplicate="onDuplicate(cap)"
          @remove="onRemove(cap)"
        />
      </div>
      <div v-else class="empty-state">
        <ElEmpty description="没有找到相关能力" />
      </div>
    </section>

    <CapabilityDetailDrawer
      v-model="detailOpen"
      :capability="detailTarget"
      @edit="onDrawerEdit"
      @remove="onDrawerRemove"
    />

    <McpDialog v-model="mcpDialogOpen" :capability="editingMcp" @submit="onSubmit" />
    <DeleteConfirmDialog
      v-model="deleteDialogOpen"
      :capability="deleteTarget"
      @confirm="confirmRemove"
    />
  </div>
</template>
