<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal } from 'naive-ui'
import { Check, Search, X } from 'lucide-vue-next'
import { skills } from '@/data/skills'

/**
 * 新建智能体时的 skill 选择弹窗。
 *
 * 与工作台的「绑定能力」弹窗效果一致，但两者是各自独立的组件，
 * 不共用同一份实现——这里的交互（默认全选、勾选即生效）服务于新建流程。
 */
const props = defineProps<{
  show: boolean
  /** 已选中的 skill 名称 */
  selected: string[]
}>()

const emit = defineEmits<{
  close: []
  'update:selected': [names: string[]]
}>()

const keyword = ref('')

const visibleSkills = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return skills
  return skills.filter((skill) => `${skill.name}${skill.description}`.toLowerCase().includes(word))
})

const isSelected = (name: string) => props.selected.includes(name)

const toggle = (name: string) => {
  const next = isSelected(name)
    ? props.selected.filter((item) => item !== name)
    : [...props.selected, name]
  emit('update:selected', next)
}

const selectAll = () => {
  emit(
    'update:selected',
    visibleSkills.value.map((skill) => skill.name),
  )
}

const clearAll = () => {
  emit('update:selected', [])
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
    class="skill-picker-modal"
    style="width: 540px"
    :bordered="false"
    :closable="false"
    :mask-closable="true"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">选择 skills</h2>
        <p class="modal-sub">为这个智能体勾选它可以调用的能力。</p>
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
      <NInput v-model:value="keyword" size="small" placeholder="搜索 skills 名称">
        <template #prefix>
          <NIcon :size="15">
            <Search />
          </NIcon>
        </template>
      </NInput>
      <span class="selected-count">已选择 {{ props.selected.length }}</span>
    </div>

    <ul class="skill-list">
      <li v-for="skill in visibleSkills" :key="skill.name">
        <button
          type="button"
          class="skill-option"
          :class="{ checked: isSelected(skill.name) }"
          :aria-pressed="isSelected(skill.name)"
          @click="toggle(skill.name)"
        >
          <span class="skill-icon" :style="{ background: skill.iconBg, color: skill.iconColor }">
            <component :is="skill.icon" :size="17" />
          </span>
          <span class="skill-text">
            <span class="skill-name">{{ skill.name }}</span>
            <span class="skill-desc">{{ skill.description }}</span>
          </span>
          <span class="skill-check" :class="{ on: isSelected(skill.name) }">
            <Check v-if="isSelected(skill.name)" :size="13" />
          </span>
        </button>
      </li>
      <li v-if="!visibleSkills.length" class="skill-empty">没有匹配的结果</li>
    </ul>

    <footer class="modal-foot">
      <div class="foot-links">
        <button type="button" class="link" @click="selectAll">全选</button>
        <button type="button" class="link" @click="clearAll">清空</button>
      </div>
      <div class="foot-actions">
        <NButton size="small" @click="emit('close')">取消</NButton>
        <NButton size="small" type="primary" @click="emit('close')">确定</NButton>
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

.skill-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  margin: 0;
  padding: 0 2px 0 0;
  overflow-y: auto;
  list-style: none;
}

.skill-option {
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

.skill-option:hover {
  border-color: var(--c-border-strong);
}

.skill-option.checked {
  background: #faf9ff;
  border-color: #cfcaff;
}

.skill-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--radius);
}

.skill-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skill-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.skill-desc {
  overflow: hidden;
  font-size: 10px;
  line-height: 1.5;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 19px;
  height: 19px;
  border: 1px solid var(--c-text-disabled);
  border-radius: 5px;
  color: #fff;
}

.skill-check.on {
  background: var(--c-accent);
  border-color: var(--c-accent);
}

.skill-empty {
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

.foot-links {
  display: flex;
  gap: 12px;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  color: var(--c-text-3);
}

.link:hover {
  color: var(--c-accent);
}

.foot-actions {
  display: flex;
  gap: 8px;
}
</style>
