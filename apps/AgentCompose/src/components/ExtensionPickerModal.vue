<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, NSpin, useMessage } from 'naive-ui'
import { Check, Search } from 'lucide-vue-next'
import ToolboxIcon from '@/components/ToolboxIcon.vue'
import { listExtensions, type ExtensionInfo } from '@/api/extensions'

/**
 * 智能体的 Pi 扩展选择弹窗。
 *
 * 只列**工具箱里**的扩展 —— npm 下载的和自定义的。
 * Pi 自带的（全局目录里的）不列：那些运行时自己会加载，不用绑。
 *
 * 选中的是相对扩展库的引用：`extensions/<来源>/<名字>`。
 */
const props = defineProps<{
  show: boolean
  /** 已选中的扩展（相对引用，如 `extensions/npm/pi-mcp-adapter`） */
  selected: string[]
}>()

const emit = defineEmits<{
  close: []
  'update:selected': [refs: string[]]
}>()

const message = useMessage()
const keyword = ref('')
/** 工具箱里的扩展（npm + 自定义） */
const extensions = ref<ExtensionInfo[]>([])
const loading = ref(false)

/** 扩展的引用形式：`extensions/<来源>/<名字>` */
/** 包名 → 目录名（scoped 的斜杠换成连字符）。 */
const flatDirName = (name: string): string => name.replace(/\//g, '-')

const extensionRef = (item: ExtensionInfo): string =>
  `extensions/${item.source}/${flatDirName(item.name)}`

const load = async () => {
  loading.value = true
  try {
    const all = await listExtensions()
    // Pi 自带的运行时自动加载，不用绑
    extensions.value = all.filter((item) => item.source !== 'builtin')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    extensions.value = []
  } finally {
    loading.value = false
  }
}

const visible = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return extensions.value
  return extensions.value.filter((item) => `${item.name}${item.path}`.toLowerCase().includes(word))
})

const isSelected = (item: ExtensionInfo): boolean => props.selected.includes(extensionRef(item))

const toggle = (item: ExtensionInfo): void => {
  const ref = extensionRef(item)
  const next = isSelected(item)
    ? props.selected.filter((value) => value !== ref)
    : [...props.selected, ref]
  emit('update:selected', next)
}

const selectAll = (): void => {
  emit(
    'update:selected',
    visible.value.map((item) => extensionRef(item)),
  )
}

const clearAll = (): void => {
  emit('update:selected', [])
}

/** 每次打开时清空搜索并重新拉一次 */
watch(
  () => props.show,
  (show) => {
    if (!show) return
    keyword.value = ''
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    style="width: 560px"
    :bordered="false"
    title="绑定 Pi 扩展"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <div class="toolbar">
      <NInput v-model:value="keyword" size="small" clearable placeholder="搜索扩展名">
        <template #prefix>
          <NIcon :size="13">
            <Search />
          </NIcon>
        </template>
      </NInput>
      <NButton size="tiny" secondary @click="selectAll">全选</NButton>
      <NButton size="tiny" quaternary @click="clearAll">清空</NButton>
    </div>

    <NSpin :show="loading">
      <ul v-if="visible.length" class="list">
        <li v-for="item in visible" :key="item.path">
          <button
            type="button"
            class="item"
            :class="{ selected: isSelected(item) }"
            :aria-pressed="isSelected(item)"
            @click="toggle(item)"
          >
            <span class="check" aria-hidden="true">
              <NIcon v-if="isSelected(item)" :size="12">
                <Check />
              </NIcon>
            </span>
            <span class="item-icon" aria-hidden="true">
              <ToolboxIcon :size="15" />
            </span>
            <span class="item-text">
              <span class="item-name">
                {{ item.name }}
                <span class="item-tag">{{ item.source === 'npm' ? 'npm' : '自定义' }}</span>
              </span>
              <code class="item-path mono">{{ extensionRef(item) }}</code>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">
        工具箱里还没有扩展 —— 到「Pi 扩展」页装一个或自己写一个。
      </p>
    </NSpin>

    <template #footer>
      <div class="footer">
        <span class="footer-text">已选 {{ selected.length }} 个</span>
        <NButton size="small" @click="emit('close')">完成</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.toolbar > :first-child {
  flex: 1;
  min-width: 0;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 420px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  text-align: left;
}

.item:hover {
  border-color: var(--c-border-strong);
}

.item.selected {
  border-color: var(--c-accent);
  background: #f1f1ee;
}

.check {
  display: grid;
  place-items: center;
  flex: none;
  width: 15px;
  height: 15px;
  border: 1px solid var(--c-border-strong);
  border-radius: 3px;
  color: var(--c-accent);
}

.item.selected .check {
  border-color: var(--c-accent);
}

.item-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  color: var(--c-text-3);
}

.item-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.item-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.item-tag {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 10px;
  color: var(--c-text-3);
}

.item-path {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-4);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: 0;
  padding: 28px 0;
  font-size: 12px;
  text-align: center;
  color: var(--c-text-3);
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.footer-text {
  font-size: 12px;
  color: var(--c-text-3);
}
</style>
