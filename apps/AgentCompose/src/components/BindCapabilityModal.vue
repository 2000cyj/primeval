<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { NButton, NIcon, NInput, NModal } from 'naive-ui'
import { Check, Search, X } from 'lucide-vue-next'

export type BindItem = {
  id: string
  name: string
  description: string
  icon: Component
  iconBg: string
  iconColor: string
}

const props = defineProps<{
  show: boolean
  /** 标题，如「绑定 skills」 */
  title: string
  /** 副标题，如「为 Claude Code 选择可调用的能力。」 */
  subtitle: string
  /** 搜索框占位文案 */
  searchPlaceholder: string
  /** 可选列表 */
  items: BindItem[]
  /** 已选中的 id（受控） */
  selected: string[]
  /** 单位名，用于底部文案，如「skills」「MCP」 */
  unit: string
}>()

const emit = defineEmits<{
  close: []
  'update:selected': [ids: string[]]
  confirm: [ids: string[]]
}>()

const keyword = ref('')

const visibleItems = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return props.items
  return props.items.filter((item) =>
    `${item.name}${item.description}`.toLowerCase().includes(word),
  )
})

const isSelected = (id: string) => props.selected.includes(id)

const toggle = (id: string) => {
  const next = isSelected(id)
    ? props.selected.filter((item) => item !== id)
    : [...props.selected, id]
  emit('update:selected', next)
}

// 每次打开时清空搜索
watch(
  () => props.show,
  (show) => {
    if (show) keyword.value = ''
  },
)
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="bind-modal"
    style="width: 540px"
    :bordered="false"
    :closable="false"
    :mask-closable="true"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">{{ props.title }}</h2>
        <p class="modal-sub">{{ props.subtitle }}</p>
      </div>
      <NButton quaternary circle size="tiny" aria-label="关闭" @click="emit('close')">
        <template #icon>
          <NIcon :size="16">
            <X />
          </NIcon>
        </template>
      </NButton>
    </header>

    <div class="search-row">
      <NInput v-model:value="keyword" size="small" :placeholder="props.searchPlaceholder">
        <template #prefix>
          <NIcon :size="15">
            <Search />
          </NIcon>
        </template>
      </NInput>
      <span class="selected-count">已选择 {{ props.selected.length }}</span>
    </div>

    <div class="item-list">
      <button
        v-for="item in visibleItems"
        :key="item.id"
        type="button"
        class="item"
        :class="{ checked: isSelected(item.id) }"
        :aria-pressed="isSelected(item.id)"
        @click="toggle(item.id)"
      >
        <span class="item-icon" :style="{ background: item.iconBg, color: item.iconColor }">
          <component :is="item.icon" :size="17" />
        </span>
        <span class="item-text">
          <span class="item-name">{{ item.name }}</span>
          <span class="item-desc">{{ item.description }}</span>
        </span>
        <span class="item-check" :class="{ on: isSelected(item.id) }">
          <Check v-if="isSelected(item.id)" :size="13" />
        </span>
      </button>
      <p v-if="!visibleItems.length" class="item-empty">没有匹配的结果</p>
    </div>

    <footer class="modal-foot">
      <span class="foot-text">将绑定 {{ props.selected.length }} 个 {{ props.unit }}</span>
      <div class="foot-actions">
        <NButton size="small" @click="emit('close')">取消</NButton>
        <NButton size="small" type="primary" @click="emit('confirm', props.selected)">
          确认绑定
        </NButton>
      </div>
    </footer>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--c-border);
}

.modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-strong);
}

.modal-sub {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0 12px;
}

.selected-count {
  flex: none;
  font-size: 11px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.item-list {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  text-align: left;
}

.item:hover {
  border-color: var(--c-border-strong);
}

.item.checked {
  background: #faf9ff;
  border-color: #cfcaff;
}

.item-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--radius);
}

.item-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.item-desc {
  overflow: hidden;
  font-size: 10px;
  line-height: 1.5;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 19px;
  height: 19px;
  border: 1px solid var(--c-text-disabled);
  border-radius: 5px;
  color: #fff;
}

.item-check.on {
  background: var(--c-accent);
  border-color: var(--c-accent);
}

.item-empty {
  margin: 0;
  padding: 32px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--c-border);
}

.foot-text {
  font-size: 11px;
  color: var(--c-text-3);
}

.foot-actions {
  display: flex;
  gap: 8px;
}
</style>
