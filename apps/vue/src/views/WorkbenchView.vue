<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { ElInput } from 'element-plus'
import CapabilityCard from '../components/capabilities/CapabilityCard.vue'
import CapabilityDetailDrawer from '../components/capabilities/CapabilityDetailDrawer.vue'
import SummaryCards from '../components/capabilities/SummaryCards.vue'
import SkillDialog from '../components/capabilities/SkillDialog.vue'
import McpDialog from '../components/capabilities/McpDialog.vue'
import DeleteConfirmDialog from '../components/capabilities/DeleteConfirmDialog.vue'
import AppIcon from '../components/icons/AppIcon.vue'
import { useToast } from '../composables/useToast'
import { useUiState } from '../composables/useUiState'
import { useCapabilities } from '../composables/useCapabilities'
import type { Capability } from '../mocks/types'
import {
  MCP_CATEGORIES,
  MCP_FILTER_CHIPS,
  SKILL_CATEGORIES,
  SKILL_FILTER_CHIPS,
} from '../mocks/types'
import { workspaceStats } from '../mocks/workspaceStats'

type TabKey = 'skills' | 'mcp'
type StatusFilter = '' | '已启用' | '已停用'

const { push } = useToast()
const { ui } = useUiState()
const { skills, mcps, remove, toggle } = useCapabilities()

const activeTab = ref<TabKey>('skills')
const keyword = ref('')
const category = ref('')
const statusFilter = ref<StatusFilter>('')
const filterOpen = ref(false)

const skillDialogOpen = ref(false)
const mcpDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const detailOpen = ref(false)
const editingSkill = ref<Capability | null>(null)
const editingMcp = ref<Capability | null>(null)
const deleteTarget = ref<Capability | null>(null)
const detailTarget = ref<Capability | null>(null)

const currentList = computed<Capability[]>(() =>
  activeTab.value === 'skills' ? skills.value : mcps.value,
)

// 面包屑第二段随页签切换：能力中心 > Skills ／ 能力中心 > MCP 服务
watchEffect(() => {
  ui.crumbTail = activeTab.value === 'skills' ? 'Skills' : 'MCP 服务'
})
onBeforeUnmount(() => {
  ui.crumbTail = ''
})

const searchPlaceholder = computed(() =>
  activeTab.value === 'skills' ? '搜索 Skill 名称或描述' : '搜索 MCP 服务',
)

// 分类筛选 chips（随页签切换，原型口径）
const filterChips = computed<readonly string[]>(() =>
  activeTab.value === 'skills' ? SKILL_FILTER_CHIPS : MCP_FILTER_CHIPS,
)

// 「筛选」面板里的「分类」分组：全部 + 该页签的全部分类（比行内 chips 更全）
const filterCategories = computed<readonly string[]>(() =>
  activeTab.value === 'skills' ? ['全部', ...SKILL_CATEGORIES] : ['全部', ...MCP_CATEGORIES],
)

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: '全部', value: '' },
  { label: '已启用', value: '已启用' },
  { label: '已停用', value: '已停用' },
]

const filteredList = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  return currentList.value.filter((item) => {
    const matchKey =
      !key || item.name.toLowerCase().includes(key) || item.description.toLowerCase().includes(key)
    const matchCategory = !category.value || item.category === category.value
    const matchStatus =
      !statusFilter.value || (statusFilter.value === '已启用' ? item.enabled : !item.enabled)
    return matchKey && matchCategory && matchStatus
  })
})

const skillTotal = computed(() => skills.value.length)
const mcpTotal = computed(() => mcps.value.length)
const mcpRunning = computed(() => mcps.value.filter((item) => item.enabled).length)
// 页签右侧的启用数量：随页签统计当前页签的已启用能力
const enabledTotal = computed(() => currentList.value.filter((item) => item.enabled).length)

const hasFilter = computed(() => Boolean(statusFilter.value) || category.value !== '')

// 筛选按钮右上角的计数角标（原型：分类 + 状态命中的条数）
const filterCount = computed(() => (category.value ? 1 : 0) + (statusFilter.value ? 1 : 0))

const filterHost = ref<HTMLElement | null>(null)

const onDocClick = (event: MouseEvent) => {
  if (filterOpen.value && filterHost.value && !filterHost.value.contains(event.target as Node)) {
    filterOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const resetFilters = () => {
  keyword.value = ''
  category.value = ''
  statusFilter.value = ''
}

const onSelectChip = (item: string) => {
  if (item === '全部') {
    category.value = ''
    return
  }
  category.value = category.value === item ? '' : item
}

// 「全部」对应未筛选状态（category 为空串）
const isCategoryActive = (item: string) => category.value === (item === '全部' ? '' : item)

const openDetail = (cap: Capability) => {
  detailTarget.value = cap
  detailOpen.value = true
}

const openCreateSkill = () => {
  editingSkill.value = null
  skillDialogOpen.value = true
}

const openCreateMcp = () => {
  editingMcp.value = null
  mcpDialogOpen.value = true
}

// 页头右侧的「新建能力」按钮：文案随页签切换（原型口径）
const createLabel = computed(() => (activeTab.value === 'skills' ? '新建 Skill' : '连接 MCP'))

// 按当前页签新建对应能力
const openCreate = () => {
  if (activeTab.value === 'skills') {
    openCreateSkill()
    return
  }
  openCreateMcp()
}

const openEditSkill = (cap: Capability) => {
  editingSkill.value = cap
  skillDialogOpen.value = true
}

const openEditMcp = (cap: Capability) => {
  editingMcp.value = cap
  mcpDialogOpen.value = true
}

const onCardEdit = (cap: Capability) => {
  if (cap.kind === 'mcp') {
    openEditMcp(cap)
    return
  }
  openEditSkill(cap)
}

const onDuplicate = (cap: Capability) => {
  push(`已创建副本：${cap.name}`)
}

const onRemove = (cap: Capability) => {
  deleteTarget.value = cap
  deleteDialogOpen.value = true
}

// 详情抽屉里的「编辑配置」/「删除」：复用卡片上的同一套弹窗
const onDrawerEdit = () => {
  if (detailTarget.value) onCardEdit(detailTarget.value)
}

const onDrawerRemove = () => {
  if (detailTarget.value) onRemove(detailTarget.value)
}

const confirmRemove = () => {
  const target = deleteTarget.value
  if (!target) return
  remove(target.id)
  detailOpen.value = false
  push('已删除该能力')
}

const onSkillSubmit = (payload: { name: string; description: string; category: string }) => {
  const target = editingSkill.value
  if (target) {
    target.name = payload.name
    target.description = payload.description
    target.category = payload.category
    push('修改已保存')
    return
  }
  skills.value = [
    {
      id: `skill-${skills.value.length + 1}`,
      kind: 'skill',
      name: payload.name,
      description: payload.description,
      category: payload.category,
      icon: 'sparkles',
      iconColor: 'violet',
      enabled: true,
      statusLabel: '运行中',
      updatedAt: '刚刚',
      usage: [...(skills.value[0]?.usage ?? [])],
      calls: 0,
    },
    ...skills.value,
  ]
  push('Skill 创建成功')
}

const onMcpSubmit = (payload: { name: string; description: string; category: string }) => {
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
        <div class="eyebrow">AGENT CAPABILITIES</div>
        <h1 class="title">能力中心</h1>
        <p>统一管理智能体可调用的 Skills 与 MCP 服务</p>
      </div>
      <div class="heading-actions">
        <button class="primary-button" type="button" :aria-label="createLabel" @click="openCreate">
          <AppIcon name="plus" :size="18" />
          {{ createLabel }}
        </button>
      </div>
    </header>

    <SummaryCards
      :skill-total="skillTotal"
      :skill-delta="workspaceStats.skillDelta"
      :mcp-total="mcpTotal"
      :mcp-running="mcpRunning"
      :monthly-calls="workspaceStats.monthlyCalls"
      :monthly-calls-delta="workspaceStats.monthlyCallsDelta"
    />

    <section class="manager-panel">
      <div class="panel-top">
        <div class="tabs">
          <button
            type="button"
            :class="{ active: activeTab === 'skills' }"
            @click="activeTab = 'skills'"
          >
            Skills
            <span class="tab-count">{{ skills.length }}</span>
          </button>
          <button type="button" :class="{ active: activeTab === 'mcp' }" @click="activeTab = 'mcp'">
            MCP 服务
            <span class="tab-count">{{ mcps.length }}</span>
          </button>
        </div>
        <div class="panel-status">
          <span class="status-dot" />
          {{ enabledTotal }} 个已启用
        </div>
      </div>

      <div class="toolbar">
        <ElInput v-model="keyword" :placeholder="searchPlaceholder" clearable>
          <template #prefix>
            <AppIcon name="search" :size="18" />
          </template>
          <template #suffix>
            <kbd>⌘ K</kbd>
          </template>
        </ElInput>

        <div ref="filterHost" class="filter-wrap">
          <button
            class="filter-button"
            :class="{ active: hasFilter }"
            type="button"
            :aria-expanded="filterOpen"
            @click.stop="filterOpen = !filterOpen"
          >
            <AppIcon name="filter" :size="17" />
            筛选
            <span v-if="filterCount" class="filter-count">{{ filterCount }}</span>
          </button>
          <div v-if="filterOpen" class="filter-pop" @click.stop>
            <span class="pop-label">分类</span>
            <div class="filter-options">
              <button
                v-for="item in filterCategories"
                :key="item"
                type="button"
                :class="{ selected: isCategoryActive(item) }"
                @click="category = item === '全部' ? '' : item"
              >
                {{ item }}
                <AppIcon v-if="isCategoryActive(item)" name="check" :size="14" />
              </button>
            </div>
            <span class="pop-label">状态</span>
            <div class="filter-options">
              <button
                v-for="item in STATUS_OPTIONS"
                :key="item.label"
                type="button"
                :class="{ selected: statusFilter === item.value }"
                @click="statusFilter = item.value"
              >
                {{ item.label }}
                <AppIcon v-if="statusFilter === item.value" name="check" :size="14" />
              </button>
            </div>
            <div class="pop-foot">
              <button type="button" @click="resetFilters">重置筛选</button>
            </div>
          </div>
        </div>

        <div class="filter-chips">
          <button
            v-for="item in filterChips"
            :key="item"
            type="button"
            :class="{ active: isCategoryActive(item) }"
            @click="onSelectChip(item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div v-if="filteredList.length" class="card-grid">
        <CapabilityCard
          v-for="cap in filteredList"
          :key="cap.id"
          :cap="cap"
          @toggle="toggle(cap)"
          @detail="openDetail(cap)"
          @edit="onCardEdit(cap)"
          @duplicate="onDuplicate(cap)"
          @remove="onRemove(cap)"
        />
      </div>
      <div v-else class="empty-state">
        <span class="empty-icon"><AppIcon name="search" :size="24" /></span>
        <strong>没有找到相关能力</strong>
        <span>尝试更换搜索词或筛选条件</span>
      </div>
    </section>

    <CapabilityDetailDrawer
      v-model="detailOpen"
      :capability="detailTarget"
      @edit="onDrawerEdit"
      @remove="onDrawerRemove"
    />

    <SkillDialog v-model="skillDialogOpen" :capability="editingSkill" @submit="onSkillSubmit" />
    <McpDialog v-model="mcpDialogOpen" :capability="editingMcp" @submit="onMcpSubmit" />
    <DeleteConfirmDialog
      v-model="deleteDialogOpen"
      :capability="deleteTarget"
      @confirm="confirmRemove"
    />
  </div>
</template>
