<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import {
  NButton,
  NCheckbox,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import { Plus, RefreshCw, Search, Sparkles } from 'lucide-vue-next'
import { Copy, Download, FolderInput, Globe, Monitor, Pencil } from 'lucide-vue-next'
import { type Skill } from '@/data/skills'
import { useCreatedAgents } from '@/data/createdAgents'
import {
  listSkills,
  refreshSkill,
  removeSkill,
  setSkillEnabled,
  type SkillInfo,
  type SkillSource,
} from '@/api/skills'
import SkillRowMenu, { type SkillMenuAction } from '@/components/SkillRowMenu.vue'
import SkillDetailDrawer from '@/components/SkillDetailDrawer.vue'
import SkillCreateModal, { type CreateMethod } from '@/components/SkillCreateModal.vue'
import SkillEditModal from '@/components/SkillEditModal.vue'
import SkillDuplicateModal from '@/components/SkillDuplicateModal.vue'
import FilterMenu, { type FilterGroup, type FilterOption } from '@/components/FilterMenu.vue'

const message = useMessage()
const query = ref('')

/**
 * 列表只认工作区里真实落盘的 skill —— 不再混入演示数据。
 * 读不到就报真实原因，不用假数据充数。
 */
const skillList = ref<Skill[]>([])
const loading = ref(false)
const loadError = ref('')

/** 勾选中的 skill 名 */
const selected = ref<string[]>([])
/** 正在刷新 */
const refreshing = ref(false)

/**
 * 筛选条件。
 *
 * 维度键 → 选中的值。同一维度内多选是「或」，维度之间是「且」。
 */
const filters = ref<Record<string, string[]>>({})

/** 筛掉不符合条件的 skill */
const matchFilters = (skill: Skill): boolean => {
  const status = filters.value.status ?? []
  if (status.length) {
    const key = skill.enabled ? 'enabled' : 'disabled'
    if (!status.includes(key)) return false
  }
  const source = filters.value.source ?? []
  if (source.length && !source.includes(skill.sourceKey ?? 'manual')) return false
  const agent = filters.value.agent ?? []
  if (agent.length && !skill.agentNames.some((name) => agent.includes(name))) {
    return false
  }
  return true
}

const visibleSkills = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return skillList.value.filter((skill) => {
    if (!matchFilters(skill)) return false
    if (!keyword) return true
    return `${skill.name}${skill.description}`.toLowerCase().includes(keyword)
  })
})

/**
 * 筛选菜单的选项（带计数）。
 *
 * 计数是**该维度下命中多少条** —— 不是当前筛选后的数量，
 * 这样用户能看出还有多少条没被选进来。
 */
const filterGroups = computed<FilterGroup[]>(() => {
  const all = skillList.value

  const statusOptions: FilterOption[] = [
    { value: 'enabled', label: '启用', count: all.filter((s) => s.enabled).length },
    { value: 'disabled', label: '停用', count: all.filter((s) => !s.enabled).length },
  ]

  // 来源：只列出真有的，按数量从多到少
  const sourceCount = new Map<string, number>()
  for (const skill of all) {
    const key = skill.sourceKey ?? 'manual'
    sourceCount.set(key, (sourceCount.get(key) ?? 0) + 1)
  }
  const sourceOptions: FilterOption[] = [...sourceCount.entries()]
    .map(([value, count]) => ({
      value,
      label: sourceLabel(value as SkillSource),
      count,
      icon: sourceIcon(value as SkillSource),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  // 被谁使用：只列出真有人用的
  const agentCount = new Map<string, number>()
  for (const skill of all) {
    for (const name of skill.agentNames) {
      agentCount.set(name, (agentCount.get(name) ?? 0) + 1)
    }
  }
  const agentOptions: FilterOption[] = [...agentCount.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  return [
    { key: 'status', label: '使用状态', options: statusOptions },
    { key: 'source', label: '数据来源', options: sourceOptions },
    { key: 'agent', label: '被谁使用', options: agentOptions },
  ]
})

/** 当前页是否全选（只看筛选后可见的行） */
const allVisibleSelected = computed(
  () =>
    visibleSkills.value.length > 0 &&
    visibleSkills.value.every((skill) => selected.value.includes(skill.name)),
)

/** 半选：部分可见行被勾上 */
const someVisibleSelected = computed(
  () =>
    !allVisibleSelected.value &&
    visibleSkills.value.some((skill) => selected.value.includes(skill.name)),
)

const toggleSelect = (name: string, checked: boolean) => {
  const next = new Set(selected.value)
  if (checked) next.add(name)
  else next.delete(name)
  selected.value = [...next]
}

/** 表头全选 / 取消全选（只影响当前可见的行） */
const toggleSelectAll = (checked: boolean) => {
  const next = new Set(selected.value)
  for (const skill of visibleSkills.value) {
    if (checked) next.add(skill.name)
    else next.delete(skill.name)
  }
  selected.value = [...next]
}

/** 从来源更新勾选的 skill：逐个刷新，失败/不可更新的分别计数 */
const refreshSelected = async () => {
  const names = [...selected.value]
  if (!names.length || refreshing.value) return
  refreshing.value = true
  let updated = 0
  const skipped: string[] = []
  const failed: string[] = []
  for (const name of names) {
    // 本地就能判定没有来源的，不浪费一次调用
    const target = skillList.value.find((skill) => skill.name === name)
    if (target && target.refreshable === false) {
      skipped.push(name)
      continue
    }
    try {
      const info = await refreshSkill(name)
      const index = skillList.value.findIndex((skill) => skill.name === name)
      if (index >= 0) skillList.value.splice(index, 1, toDisplaySkill(info))
      updated += 1
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (detail.includes('没有可更新的来源')) skipped.push(name)
      else failed.push(`${name}：${detail}`)
    }
  }
  refreshing.value = false
  if (updated) message.success(`已从来源更新 ${updated} 个 skill`)
  if (skipped.length)
    message.warning(`${skipped.length} 个没有可更新的来源，已跳过：${skipped.join('、')}`)
  if (failed.length) message.error(`${failed.length} 个更新失败：${failed[0]}`)
}

const toggleSkill = (skill: Skill) => {
  const next = !skill.enabled
  skill.enabled = next
  // 状态是持久化的：写失败就回滚，不让界面显示一个没生效的状态。
  void setSkillEnabled(skill.name, next).catch((error: unknown) => {
    skill.enabled = !next
    message.error(error instanceof Error ? error.message : String(error))
  })
}

/** 当前打开详情抽屉的 skill */
const detailSkill = ref<Skill | null>(null)
/** 新建 skill 弹窗 */
const showCreate = ref(false)
/** 直接打开某种添加方式；为空则先选方式 */
const createMethod = ref<CreateMethod | null>(null)
/** 待删除的 skill（删除前二次确认） */
const deleteTarget = ref<Skill | null>(null)
/** 编辑弹窗 */
const showEdit = ref(false)
const editTarget = ref<string | null>(null)
/** 创建副本弹窗 */
const showDuplicate = ref(false)
const duplicateTarget = ref<string | null>(null)

/** 新导入的 skill 在列表里的配色（按名字散列，保证同一个 skill 颜色稳定） */
const palette = [
  { iconBg: '#EEF2FF', iconColor: '#4F46E5' },
  { iconBg: '#EFF6FF', iconColor: '#2563EB' },
  { iconBg: '#ECFDF5', iconColor: '#047857' },
  { iconBg: '#FFF0E8', iconColor: '#D97745' },
  { iconBg: '#FFFBEB', iconColor: '#B45309' },
  { iconBg: '#F1F5F9', iconColor: '#475569' },
]

const colorOf = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}

/**
 * 「使用者」= 绑定了这个 skill 的智能体名称。
 *
 * 智能体那边存的是**相对路径引用**（`skills/<目录名>`），
 * 所以这里拿 skill 的 `relativePath` 去匹配，不是拿显示名。
 */
const { createdAgents, load: loadCreatedAgents } = useCreatedAgents()

const agentNamesFor = (relativePath: string): string[] =>
  createdAgents.value
    .filter((agent) => agent.skills.includes(relativePath))
    .map((agent) => agent.name)

/** 把后端返回的 skill 转成列表里展示的结构 */
const toDisplaySkill = (info: SkillInfo): Skill => {
  const color = colorOf(info.name)
  const updated = new Date(info.updatedAtMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    name: info.name,
    // 真实 skill 没有「分类」概念，用来源代替。
    category: sourceLabel(info.source),
    source: sourceLabel(info.source),
    // 筛选按原始值匹配，不按显示文案
    sourceKey: info.source,
    description: info.description || '（暂无描述）',
    // 使用者 = 绑定了这个 skill 的智能体名称（按相对路径引用匹配）
    agentNames: agentNamesFor(info.relativePath),
    updated: `${updated.getFullYear()}-${pad(updated.getMonth() + 1)}-${pad(updated.getDate())} ${pad(updated.getHours())}:${pad(updated.getMinutes())}:${pad(updated.getSeconds())}`,
    icon: Sparkles,
    iconBg: color.iconBg,
    iconColor: color.iconColor,
    enabled: info.enabled,
    refreshable: info.refreshable,
  }
}

/** 来源的中文名 */
/** 来源文案：与「新增 skill」弹窗里的四个方式同名 */
const sourceLabel = (source: SkillInfo['source']): string => {
  const labels: Record<SkillInfo['source'], string> = {
    manual: '手动创建',
    local: '从本地导入',
    url: '从 URL 导入',
    runtime: '从运行时复制',
    duplicate: '创建副本',
    git: 'GitHub 仓库',
  }
  return labels[source] ?? source
}

/** 来源的小图标（筛选菜单里用） */
const sourceIcon = (source: SkillSource): Component => {
  const icons: Record<string, Component> = {
    manual: Pencil,
    local: FolderInput,
    url: Globe,
    runtime: Monitor,
    duplicate: Copy,
    git: Download,
  }
  return icons[source]
}

/** 读取工作区里已落盘的 skill */
const loadWorkspaceSkills = async () => {
  loading.value = true
  loadError.value = ''
  try {
    // 智能体也得读，否则「使用者」列是空的
    await loadCreatedAgents()
    const stored = await listSkills()
    skillList.value = stored.map(toDisplaySkill)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    skillList.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadWorkspaceSkills()
})

const openDetail = (skillName: string) => {
  detailSkill.value = skillList.value.find((skill) => skill.name === skillName) ?? null
}

/** 打开编辑弹窗 */
const openEdit = (skillName: string) => {
  editTarget.value = skillName
  showEdit.value = true
}

/** 打开创建副本弹窗 */
const openDuplicate = (skillName: string) => {
  duplicateTarget.value = skillName
  showDuplicate.value = true
}

const onRowAction = (action: SkillMenuAction, skillName: string) => {
  if (action === 'detail') {
    openDetail(skillName)
    return
  }
  if (action === 'delete') {
    deleteTarget.value = skillList.value.find((skill) => skill.name === skillName) ?? null
    return
  }
  if (action === 'duplicate') {
    openDuplicate(skillName)
    return
  }
  openEdit(skillName)
}

const confirmDelete = async () => {
  const target = deleteTarget.value
  if (!target) return
  try {
    await removeSkill(target.name)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    return
  }
  skillList.value = skillList.value.filter((skill) => skill.name !== target.name)
  if (detailSkill.value?.name === target.name) detailSkill.value = null
  selected.value = selected.value.filter((name) => name !== target.name)
  deleteTarget.value = null
  message.success(`已删除：${target.name}`)
}

/** 从标题栏的「添加 Skill」进入：先选方式 */
const openCreate = () => {
  createMethod.value = null
  showCreate.value = true
}

/** 添加成功：插入到列表头部 */
const onCreated = (info: SkillInfo) => {
  skillList.value = [toDisplaySkill(info), ...skillList.value]
  message.success(`已添加：${info.name}`)
}

/** 编辑保存：按名字（可能已改名）替换列表里那一项 */
const onSaved = (info: SkillInfo, previousName: string) => {
  const index = skillList.value.findIndex((skill) => skill.name === previousName)
  const next = toDisplaySkill(info)
  if (index >= 0) skillList.value.splice(index, 1, next)
  else skillList.value = [next, ...skillList.value]
  // 改名后勾选的是新名字
  if (previousName !== info.name) {
    selected.value = selected.value.map((name) => (name === previousName ? info.name : name))
  }
  if (detailSkill.value?.name === previousName) detailSkill.value = next
  message.success(`已保存：${info.name}`)
}

/** 副本创建成功：插入到列表头部 */
const onDuplicated = (info: SkillInfo) => {
  skillList.value = [toDisplaySkill(info), ...skillList.value]
  message.success(`已创建副本：${info.name}`)
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">Skills</h1>
        <p class="page-sub">
          <template v-if="loading">正在读取工作区…</template>
          <template v-else>
            {{ visibleSkills.length }} 个能力包
            <template v-if="visibleSkills.length !== skillList.length">
              （共 {{ skillList.length }} 个）
            </template>
            ，可被 agents 引用
          </template>
        </p>
      </div>
      <NSpace :size="8">
        <NButton
          size="small"
          :disabled="!selected.length || refreshing"
          :loading="refreshing"
          @click="refreshSelected"
        >
          <template #icon>
            <NIcon :size="14">
              <RefreshCw />
            </NIcon>
          </template>
          更新<span v-if="selected.length">（{{ selected.length }}）</span>
        </NButton>
        <FilterMenu v-model="filters" :groups="filterGroups" />
        <NInput
          v-model:value="query"
          class="search"
          size="small"
          clearable
          placeholder="搜索名称或描述"
        >
          <template #prefix>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
        </NInput>
        <NButton size="small" type="primary" @click="openCreate">
          <template #icon>
            <NIcon :size="14">
              <Plus />
            </NIcon>
          </template>
          添加 Skill
        </NButton>
      </NSpace>
    </header>

    <div class="card">
      <!-- 表头独立于表格体，固定不滚动 -->
      <div class="table-head table-grid" role="row">
        <span class="cell-select" role="columnheader">
          <NCheckbox
            :checked="allVisibleSelected"
            :indeterminate="someVisibleSelected"
            aria-label="全选"
            @update:checked="toggleSelectAll"
          />
        </span>
        <span role="columnheader">名称</span>
        <span role="columnheader">数据来源</span>
        <span role="columnheader">使用者</span>
        <span role="columnheader">更新时间</span>
        <span role="columnheader">状态</span>
        <span role="columnheader"><span class="sr-only">操作</span></span>
      </div>

      <!-- 只有表格体滚动 -->
      <div class="table-scroll">
        <div
          v-for="skill in visibleSkills"
          :key="skill.name"
          class="skill-row table-grid"
          :class="{ muted: !skill.enabled }"
          role="row"
        >
          <div class="cell-select" role="cell">
            <NCheckbox
              :checked="selected.includes(skill.name)"
              :aria-label="`选择 ${skill.name}`"
              @update:checked="(checked: boolean) => toggleSelect(skill.name, checked)"
            />
          </div>
          <div class="cell-name" role="cell">
            <span
              class="cell-icon"
              :style="{ background: skill.iconBg, color: skill.iconColor }"
              aria-hidden="true"
            >
              <component :is="skill.icon" :size="15" />
            </span>
            <span class="cell-text">
              <span class="cell-title">{{ skill.name }}</span>
              <span class="cell-desc">{{ skill.description }}</span>
            </span>
          </div>

          <div class="cell-source" role="cell">
            <span class="source-tag" :class="`source-${skill.source ?? 'manual'}`">
              {{ skill.source ?? '手动创建' }}
            </span>
          </div>

          <div class="cell-users" role="cell">
            <span v-if="skill.agentNames.length" class="user-tags">
              <NTag
                v-for="agentName in skill.agentNames"
                :key="agentName"
                size="small"
                :bordered="false"
                class="user-tag"
              >
                {{ agentName }}
              </NTag>
            </span>
            <span v-else class="cell-muted">暂无使用者</span>
          </div>

          <div class="cell-muted tnum" role="cell">{{ skill.updated }}</div>

          <div role="cell">
            <NSwitch
              :value="skill.enabled"
              size="small"
              :aria-label="`${skill.name} 状态`"
              @update:value="toggleSkill(skill)"
            />
          </div>

          <div class="cell-actions" role="cell">
            <SkillRowMenu
              :skill-name="skill.name"
              @action="(action: SkillMenuAction, name: string) => onRowAction(action, name)"
            />
          </div>
        </div>

        <p v-if="loadError" class="load-error" role="alert">
          读取工作区 skill 失败：{{ loadError }}
        </p>

        <p v-if="!visibleSkills.length" class="empty">
          <template v-if="loading">正在读取工作区…</template>
          <template v-else-if="loadError">读取失败，没有可展示的 skill。</template>
          <template v-else-if="query.trim()">没有匹配的 Skill</template>
          <template v-else>工作区里还没有 skill，点右上角「添加 Skill」创建一个。</template>
        </p>
      </div>
    </div>

    <SkillCreateModal
      v-model:show="showCreate"
      :initial-method="createMethod"
      @close="showCreate = false"
      @created="onCreated"
    />

    <SkillDetailDrawer
      :skill-name="detailSkill?.name ?? null"
      @close="detailSkill = null"
      @edit="(name: string) => openEdit(name)"
      @toggle="
        (name: string, enabled: boolean) => {
          const skill = skillList.find((item) => item.name === name)
          if (skill) skill.enabled = enabled
        }
      "
      @remove="
        (name: string) => {
          deleteTarget = skillList.find((item) => item.name === name) ?? null
        }
      "
    />

    <SkillEditModal
      v-model:show="showEdit"
      :skill-name="editTarget"
      @close="showEdit = false"
      @saved="(info: SkillInfo) => onSaved(info, editTarget ?? info.name)"
    />

    <SkillDuplicateModal
      v-model:show="showDuplicate"
      :skill-name="duplicateTarget"
      @close="showDuplicate = false"
      @created="onDuplicated"
    />

    <NModal
      :show="deleteTarget !== null"
      preset="card"
      class="confirm-modal"
      style="width: 360px"
      :bordered="false"
      title="删除 skill"
      @update:show="(show: boolean) => !show && (deleteTarget = null)"
    >
      <p class="confirm-text">
        确定要删除 <strong>{{ deleteTarget?.name }}</strong> 吗？该操作不可撤销。
      </p>
      <div class="confirm-actions">
        <NButton size="small" @click="deleteTarget = null">取消</NButton>
        <NButton size="small" type="error" @click="confirmDelete">删除</NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.page {
  /* 整页不滚动：页面头部与表头固定，只有表格体滚动 */
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  padding: 20px 24px 24px;
  overflow: hidden;
}

.page-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.search {
  width: 240px;
}

.card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

/* 表头与数据行共用同一套列宽定义，保证纵向对齐 */
.table-grid {
  display: grid;
  /* 第一列是多选框，固定宽度；「使用者」列也固定宽度，标签多了换行 */
  grid-template-columns: 28px 34fr 14fr 200px 15fr 9fr 6fr;
  align-items: center;
  column-gap: 12px;
  padding: 0 20px;
}

.table-head {
  flex: none;
  height: 39px;
  background: var(--c-surface-sunken);
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text-3);
  font-size: 13px;
  font-weight: 500;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.skill-row {
  min-height: 51px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--c-border);
  transition: background 0.15s;
}

.skill-row:hover {
  background: var(--c-surface-sunken);
}

.skill-row.muted {
  background: var(--c-surface-sunken);
}

.cell-select {
  display: flex;
  align-items: center;
  justify-content: center;
}

.cell-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cell-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}

.cell-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.cell-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
}

.cell-desc {
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-source {
  display: flex;
  align-items: center;
  min-width: 0;
}

.source-tag {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-3);
  white-space: nowrap;
}

/* 四种来源各自一个色，一眼能分清 */
.source-manual {
  background: #eef2ff;
  color: #4f46e5;
}

.source-local {
  background: #eff6ff;
  color: #2563eb;
}

.source-url {
  background: #ecfdf5;
  color: #047857;
}

.source-runtime {
  background: #fff0e8;
  color: #d97745;
}

.source-duplicate {
  background: #fffbeb;
  color: #b45309;
}

.cell-users {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

/** 智能体名称标签：宽度不够就换行 */
.user-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.user-tag {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-muted {
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.cell-actions {
  display: flex;
  justify-content: flex-end;
}

.empty {
  margin: 0;
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-3);
}

.load-error {
  margin: 0;
  padding: 10px 20px;
  background: rgb(190 18 60 / 10%);
  font-size: 12px;
  color: #be123c;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
