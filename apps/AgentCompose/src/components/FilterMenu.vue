<script setup lang="ts">
/**
 * 多级筛选器。
 *
 * 漏斗按钮 → 弹出菜单 → 每个维度能展开出具体值（二级菜单），
 * 右边带计数。选中项打勾，同一维度内多选是「或」，维度之间是「且」。
 *
 * 用 NPopover 而不是 NDropdown：NDropdown 的选项是命令式的（选完就关），
 * 这里需要多选、还要显示勾选状态和计数。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { NButton, NIcon, NPopover } from 'naive-ui'
import { Check, ChevronRight, ListFilter } from 'lucide-vue-next'
import EllipsisText from '@/components/EllipsisText.vue'

export type FilterOption = {
  /** 选中后记进 modelValue 的值 */
  value: string
  /** 显示文案 */
  label: string
  /** 这个值下有多少条 */
  count: number
  /** 可选的小图标 */
  icon?: Component
}

export type FilterGroup = {
  /** 维度的键 */
  key: string
  /** 维度名（「使用状态」「来源」…） */
  label: string
  /** 该维度下的具体值 */
  options: FilterOption[]
}

const props = defineProps<{
  /** 每个维度选中的值 */
  modelValue: Record<string, string[]>
  /** 可选的维度 */
  groups: FilterGroup[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string[]>]
}>()

/** 当前展开的维度（二级菜单） */
const openGroup = ref<string | null>(null)

/** 二级菜单往哪边飞：'right' | 'left' */
const submenuSide = ref<'right' | 'left'>('right')

/** 弹层面板（用来量它离窗口右边多远） */
const panelEl = ref<HTMLElement | null>(null)

/** 二级菜单大概要这么宽（min-width 168 + 间隙 4 + 余量） */
const SUBMENU_WIDTH = 190

/**
 * 量一下二级菜单该往哪边飞。
 *
 * 筛选按钮在工具栏最右边 —— 二级菜单默认往右飞会直接飞出窗口，
 * 用户只能看到「使用状态 / 数据来源 / 被谁使用」三个标题，
 * 真正的选项（启用 / 停用、哪个 agent……）全在屏幕外。
 *
 * 所以量一量：右边放不下就往左飞。
 */
const measureSubmenuSide = (): void => {
  const el = panelEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const roomRight = window.innerWidth - rect.right
  const roomLeft = rect.left
  if (roomRight >= SUBMENU_WIDTH) {
    submenuSide.value = 'right'
  } else if (roomLeft >= SUBMENU_WIDTH) {
    submenuSide.value = 'left'
  } else {
    // 两边都放不下 —— 挑宽敞的那边，至少别整个看不见
    submenuSide.value = roomRight >= roomLeft ? 'right' : 'left'
  }
}

/** 弹层打开时重新量一次（面板位置变了） */
const onShow = (show: boolean): void => {
  if (!show) return
  // 等弹层布局完、位置定了再量 —— nextTick 只等渲染，位置可能还没落
  void nextTick(() => {
    requestAnimationFrame(() => {
      measureSubmenuSide()
    })
  })
}

/** 展开某个维度 —— 顺便再量一次（面板可能刚移动过） */
const showGroup = (key: string): void => {
  openGroup.value = key
  measureSubmenuSide()
}

/** 点标题展开 / 收起 —— 也得重新量 */
const toggleGroup = (key: string): void => {
  openGroup.value = openGroup.value === key ? null : key
  measureSubmenuSide()
}

/** 窗口尺寸变了，重新决定往哪边飞 */
const onResize = (): void => {
  measureSubmenuSide()
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})

/** 一共选了多少项 */
const activeCount = computed(() =>
  Object.values(props.modelValue).reduce((sum, items) => sum + items.length, 0),
)

/** 每个维度选中了什么（用来在二级菜单里打勾） */
const selectedIn = (groupKey: string): string[] => props.modelValue[groupKey] ?? []

const isChecked = (groupKey: string, value: string): boolean => selectedIn(groupKey).includes(value)

/** 切换一个选项 */
const toggle = (groupKey: string, value: string): void => {
  const next = { ...props.modelValue }
  const current = new Set(selectedIn(groupKey))
  if (current.has(value)) current.delete(value)
  else current.add(value)
  next[groupKey] = [...current]
  emit('update:modelValue', next)
}

/** 清空所有筛选 */
const clear = (): void => {
  emit('update:modelValue', {})
  openGroup.value = null
}

/** 维度标题上的摘要（「启用 + 停用」这种太长，只显示第一个） */
const summary = (group: FilterGroup): string => {
  const picked = selectedIn(group.key)
  if (picked.length === 0) return ''
  if (picked.length === 1) {
    const hit = group.options.find((item) => item.value === picked[0])
    return hit?.label ?? picked[0]
  }
  return `${picked.length} 项`
}
</script>

<template>
  <NPopover trigger="click" placement="bottom-start" :show-arrow="false" raw @update:show="onShow">
    <template #trigger>
      <NButton
        size="small"
        class="filter-trigger"
        :type="activeCount ? 'primary' : 'default'"
        :aria-label="`筛选${activeCount ? `（已选 ${activeCount} 项）` : ''}`"
      >
        <template #icon>
          <NIcon :size="14">
            <ListFilter />
          </NIcon>
        </template>
        <span v-if="activeCount">{{ activeCount }}</span>
      </NButton>
    </template>

    <div
      ref="panelEl"
      class="filter-menu"
      :class="`submenu-${submenuSide}`"
      role="menu"
      aria-label="筛选"
    >
      <div
        v-for="group in groups"
        :key="group.key"
        class="filter-group"
        :class="{ open: openGroup === group.key }"
        @mouseenter="showGroup(group.key)"
      >
        <button
          type="button"
          class="group-head"
          role="menuitem"
          :aria-expanded="openGroup === group.key"
          :aria-haspopup="true"
          @click="toggleGroup(group.key)"
        >
          <EllipsisText class="group-label" :text="group.label" />
          <span v-if="summary(group)" class="group-summary">{{ summary(group) }}</span>
          <NIcon :size="12" class="group-arrow">
            <ChevronRight />
          </NIcon>
        </button>

        <div class="group-sub" role="menu" :aria-label="group.label">
          <button
            v-for="option in group.options"
            :key="option.value"
            type="button"
            class="group-option"
            role="menuitemcheckbox"
            :aria-checked="isChecked(group.key, option.value)"
            @click="toggle(group.key, option.value)"
          >
            <span class="option-check" aria-hidden="true">
              <NIcon v-if="isChecked(group.key, option.value)" :size="12">
                <Check />
              </NIcon>
            </span>
            <span v-if="option.icon" class="option-icon" aria-hidden="true">
              <NIcon :size="13">
                <component :is="option.icon" />
              </NIcon>
            </span>
            <EllipsisText class="option-label" :text="option.label" />
            <span class="option-count tnum">{{ option.count }}</span>
          </button>
        </div>
      </div>

      <div v-if="activeCount" class="filter-foot">
        <button type="button" class="filter-clear" @click="clear">清空筛选</button>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.filter-trigger {
  min-width: 34px;
}

.filter-menu {
  position: relative;
  min-width: 168px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  box-shadow: 0 6px 20px rgba(28, 28, 26, 0.12);
}

.filter-group {
  position: relative;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.group-head:hover,
.filter-group.open > .group-head {
  background: var(--c-surface-sunken);
  color: var(--c-text);
}

.group-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-summary {
  flex: none;
  max-width: 88px;
  overflow: hidden;
  color: var(--c-text-4);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-arrow {
  flex: none;
  color: var(--c-text-4);
}

/* 二级菜单：默认收起，hover 或点开时从右侧飞出 */
.group-sub {
  position: absolute;
  top: 0;
  left: calc(100% + 4px);
  z-index: 10;
  display: none;
  min-width: 168px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  box-shadow: 0 6px 20px rgba(28, 28, 26, 0.12);
}

/* 右边放不下时改往左飞 —— 否则整个飞出窗口，用户只看到三个标题 */
.submenu-left .group-sub {
  left: auto;
  right: calc(100% + 4px);
}

/* 往左飞时箭头也要翻过来 */
.submenu-left .group-arrow {
  transform: rotate(180deg);
}

.filter-group:hover > .group-sub,
.filter-group.open > .group-sub {
  display: block;
}

.group-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 8px 0 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.group-option:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text);
}

.option-check {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--c-accent);
}

.option-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--c-text-4);
}

.option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-count {
  flex: none;
  color: var(--c-text-4);
  font-size: 11px;
}

.filter-foot {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--c-border);
}

.filter-clear {
  width: 100%;
  height: 26px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-3);
  font-size: 12px;
  cursor: pointer;
}

.filter-clear:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text);
}
</style>
