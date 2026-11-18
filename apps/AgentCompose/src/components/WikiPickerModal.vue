<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, useMessage } from 'naive-ui'
import { BookOpen, Check, FileText, Search, X } from 'lucide-vue-next'
import { listWikiPages, type WikiPageMeta } from '@/api/wiki'
import EllipsisText from '@/components/EllipsisText.vue'

/**
 * 智能体的 wiki 页面选择弹窗。
 *
 * 绑定的是**入口页面** —— 勾了「运维」，它下面的子页面自动跟着可见
 * （后端展开子树）。所以这里只列**顶层页面 + 有子页面的页面**，
 * 不把每个叶子都铺出来 —— 铺出来用户也分不清该勾哪个。
 */
const props = defineProps<{
  show: boolean
  /** 已选中的页面（引用格式 `wiki/<slug>`） */
  selected: string[]
}>()

const emit = defineEmits<{
  close: []
  'update:selected': [refs: string[]]
}>()

const message = useMessage()
const keyword = ref('')
/** wiki 页面（扁平列表） */
const pages = ref<WikiPageMeta[]>([])
const loading = ref(false)

const load = async () => {
  loading.value = true
  try {
    pages.value = (await listWikiPages()) ?? []
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    pages.value = []
  } finally {
    loading.value = false
  }
}

/** 引用格式：`wiki/<slug>` */
const toRef = (slug: string): string => `wiki/${slug}`

/** slug 从引用里取出来。 */
const fromRef = (ref: string): string => ref.replace(/^wiki\//, '')

/** 哪些 slug 有子页面。 */
const parentSlugs = computed(() => {
  const set = new Set<string>()
  for (const page of pages.value) {
    if (page.parent) set.add(page.parent)
  }
  return set
})

/**
 * 可供勾选的页面：顶层页面 + 有子页面的页面。
 *
 * 中间层也要能选 —— 用户可能只想绑「部署」这一支，
 * 不包含它的兄弟页。
 */
const selectablePages = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  const candidates = pages.value.filter((page) => !page.parent || parentSlugs.value.has(page.slug))
  if (!word) return candidates
  return candidates.filter((page) => {
    const haystack = `${page.title} ${page.tags.join(' ')}`.toLowerCase()
    return haystack.includes(word)
  })
})

const isSelected = (slug: string): boolean => props.selected.some((ref) => fromRef(ref) === slug)

const toggle = (slug: string) => {
  const next = isSelected(slug)
    ? props.selected.filter((ref) => fromRef(ref) !== slug)
    : [...props.selected, toRef(slug)]
  emit('update:selected', next)
}

const selectAll = () => {
  emit(
    'update:selected',
    selectablePages.value.map((page) => toRef(page.slug)),
  )
}

const clearAll = () => {
  emit('update:selected', [])
}

/** 子页面数量 —— 让用户知道勾上这一页会带进多少内容。 */
const childCount = (slug: string): number =>
  pages.value.filter((page) => page.parent === slug).length

// 每次打开时清空搜索并重新拉一次
//
// `immediate: true` —— 弹窗一挂载就拉，
// 免得「以打开状态挂载」时列表是空的（ExtensionPickerModal 也是这么做的）。
watch(
  () => props.show,
  (show) => {
    if (show) {
      keyword.value = ''
      void load()
    }
  },
  { immediate: true },
)
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="wiki-picker-modal"
    style="width: 540px"
    :bordered="false"
    :closable="false"
    :mask-closable="true"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">选择知识库页面</h2>
        <p class="modal-sub">勾选入口页面 —— 它下面的子页面会自动跟着可见，不用逐个勾。</p>
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
      <NInput v-model:value="keyword" size="small" placeholder="搜索页面标题或标签">
        <template #prefix>
          <NIcon :size="15">
            <Search />
          </NIcon>
        </template>
      </NInput>
      <span class="selected-count">已选择 {{ props.selected.length }}</span>
    </div>

    <ul class="wiki-list">
      <li v-for="page in selectablePages" :key="page.slug">
        <button
          type="button"
          class="wiki-option"
          :class="{ checked: isSelected(page.slug) }"
          :aria-pressed="isSelected(page.slug)"
          @click="toggle(page.slug)"
        >
          <span class="wiki-icon">
            <FileText :size="16" />
          </span>
          <span class="wiki-text">
            <EllipsisText class="wiki-name" :text="page.title" />
            <span class="wiki-desc">
              <template v-if="page.tags.length">tags: {{ page.tags.join(', ') }}</template>
              <template v-else-if="childCount(page.slug)">
                含 {{ childCount(page.slug) }} 个子页面
              </template>
              <template v-else>（无标签）</template>
            </span>
          </span>
          <span class="wiki-check" :class="{ on: isSelected(page.slug) }">
            <Check v-if="isSelected(page.slug)" :size="13" />
          </span>
        </button>
      </li>
      <li v-if="!loading && !selectablePages.length" class="wiki-empty">
        <BookOpen :size="18" />
        <span>{{ keyword ? '没有匹配的页面' : '还没有页面 —— 先去 Wiki 页写一篇' }}</span>
      </li>
    </ul>

    <footer class="modal-foot">
      <NButton size="small" quaternary @click="clearAll">清空</NButton>
      <NButton size="small" @click="selectAll">全选</NButton>
      <NButton size="small" type="primary" @click="emit('close')">完成</NButton>
    </footer>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.modal-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.selected-count {
  flex: none;
  font-size: 11px;
  color: var(--c-text-3);
}

.wiki-list {
  max-height: 340px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--c-border);
  border-radius: 6px;
}

.wiki-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 1px solid var(--c-border);
}

.wiki-option:last-child {
  border-bottom: none;
}

.wiki-option:hover {
  background: var(--c-hover);
}

.wiki-option.checked {
  background: var(--c-accent-soft);
}

.wiki-icon {
  display: flex;
  flex: none;
  color: var(--c-text-3);
}

.wiki-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wiki-name {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiki-desc {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiki-check {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--c-accent);
  border: 1px solid var(--c-border-strong);
  border-radius: 3px;
}

.wiki-check.on {
  border-color: var(--c-accent);
}

.wiki-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  font-size: 12px;
  color: var(--c-text-3);
}

.modal-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
