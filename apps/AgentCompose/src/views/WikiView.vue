<script setup lang="ts">
/**
 * 内置 Wiki 页面。
 *
 * 左边是页面树（前端按 parent 分组，后端只给扁平列表），
 * 右边是编辑器 + 实时预览。
 *
 * 正文是 Markdown 源码，预览用项目自己的 MarkdownView（marked + DOMPurify）渲染 ——
 * 不走 md-editor-v3 自带的预览，那条路的清洗策略不由我们控制。
 */
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Search,
  Trash2,
} from 'lucide-vue-next'

// md-editor-v3 的样式不在包内自动引入，漏了这一句编辑器就是一堆没样式的标签
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import EllipsisText from '@/components/EllipsisText.vue'
import { bumpSkills, wikiRevision } from '@/data/dataRevision'
import {
  createWikiPage,
  deleteWikiPage,
  listWikiPages,
  publishWikiAsSkill,
  readWikiPage,
  saveWikiPage,
  searchWiki,
  type WikiPageMeta,
  type WikiSearchHit,
} from '@/api/wiki'

const message = useMessage()

/** 所有页面的元信息（扁平列表，树的分组在前端做） */
const pages = ref<WikiPageMeta[]>([])
/** 列表读取失败时的原因 —— 直接展示，不拿假数据充数 */
const listError = ref('')
/** 上次加载时 Wiki 数据的版本号 —— 激活时比对要不要重载。 */
let loadedRevision = -1

/** 当前打开的页面 slug（空 = 没打开任何页面） */
const currentSlug = ref('')

/** 编辑区里的内容（与后端同步前先存在这里） */
const title = ref('')
const content = ref('')
const tagsText = ref('')
/** 父页面 slug；null = 顶层 */
const parentSlug = ref<string | null>(null)

/** 最近一次从后端读到的页面 —— 用来判断「有没有改动」 */
const saved = ref<WikiPageMeta | null>(null)
const savedContent = ref('')

/** 折叠起来的节点（存 slug） */
const collapsed = ref<Set<string>>(new Set())

/** 搜索词 */
const query = ref('')
/** 搜索命中 */
const hits = ref<WikiSearchHit[]>([])
/** 搜索是否在进行 */
const searching = ref(false)

/** 待确认删除的页面 */
const deleteTarget = ref<WikiPageMeta | null>(null)

/**
 * 「顶层页面」选项的值。
 *
 * 不用空串：naive-ui 的下拉把空串当普通值处理，行为不够确定；
 * 用一个不会跟真实 slug 撞上的哨兵值最省心（slug 是目录名，不会有这个名字）。
 */
const TOP_LEVEL = '__top_level__'

/** 新建页面弹窗 */
const createOpen = ref(false)
const createTitle = ref('')
/** 新建时的父页面；哨兵值 = 顶层（后端那边是 null） */
const createParent = ref(TOP_LEVEL)

/** 树的节点。
 *
 * 用一个对象把「元信息 + 子节点」绑在一起，渲染时不用再回头查列表。
 */
interface WikiNode {
  meta: WikiPageMeta
  children: WikiNode[]
}

/**
 * 按 parent 把扁平列表组装成树。
 *
 * 后端只给扁平列表 —— 组树规则放后端的话，改一次层级就得改一次接口。
 * 父页面不在列表里的（刚被删掉）按顶层处理，不然这页就凭空消失了。
 */
const tree = computed<WikiNode[]>(() => {
  const nodes = new Map<string, WikiNode>()
  for (const meta of pages.value) {
    nodes.set(meta.slug, { meta, children: [] })
  }

  const roots: WikiNode[] = []
  for (const node of nodes.values()) {
    const parent = node.meta.parent ? nodes.get(node.meta.parent) : undefined
    if (parent && parent !== node) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (list: WikiNode[]): void => {
    list.sort((a, b) => a.meta.title.localeCompare(b.meta.title))
    for (const node of list) sortNodes(node.children)
  }
  sortNodes(roots)

  return roots
})

/**
 * 树摊平成一行行（带缩进层级）。
 *
 * 摊平而不是递归渲染组件：折叠只要在摊平时跳过子节点，
 * 不需要在模板里处理递归组件的自我引用。
 */
const treeRows = computed(() => {
  const rows: { meta: WikiPageMeta; depth: number; hasChildren: boolean; expanded: boolean }[] = []

  const walk = (nodes: WikiNode[], depth: number): void => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0
      const expanded = hasChildren && !collapsed.value.has(node.meta.slug)
      rows.push({ meta: node.meta, depth, hasChildren, expanded })
      if (expanded) walk(node.children, depth + 1)
    }
  }
  walk(tree.value, 0)

  return rows
})

/** 折叠 / 展开一个节点 */
const toggleNode = (slug: string): void => {
  const next = new Set(collapsed.value)
  if (next.has(slug)) {
    next.delete(slug)
  } else {
    next.add(slug)
  }
  collapsed.value = next
}

/** 某个页面的祖先链（从顶层往下） */
const ancestorsOf = (slug: string): WikiPageMeta[] => {
  const bySlug = new Map(pages.value.map((meta) => [meta.slug, meta]))
  const chain: WikiPageMeta[] = []
  const seen = new Set<string>()
  let cursor = bySlug.get(slug)?.parent ?? null
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const meta = bySlug.get(cursor)
    if (!meta) break
    chain.unshift(meta)
    cursor = meta.parent
  }
  return chain
}

/** 某个页面的完整路径（用标题连起来） */
const pathOf = (slug: string): string => {
  const meta = pages.value.find((item) => item.slug === slug)
  if (!meta) return ''
  return [...ancestorsOf(slug), meta].map((item) => item.title).join(' / ')
}

/** 某个页面的所有后代（防止把页面挂到自己的子孙下面） */
const descendantsOf = (slug: string): Set<string> => {
  const result = new Set<string>()
  const walk = (nodes: WikiNode[]): void => {
    for (const node of nodes) {
      if (result.has(node.meta.slug)) continue
      result.add(node.meta.slug)
      walk(node.children)
    }
  }
  const find = (nodes: WikiNode[]): WikiNode | undefined => {
    for (const node of nodes) {
      if (node.meta.slug === slug) return node
      const hit = find(node.children)
      if (hit) return hit
    }
    return undefined
  }
  const node = find(tree.value)
  if (node) walk(node.children)
  return result
}

/** 当前页面的父页面下拉选项（排除自己和自己的子孙，免得成环） */
const parentOptions = computed(() => {
  const banned = new Set<string>([currentSlug.value, ...descendantsOf(currentSlug.value)])
  const options = pages.value
    .filter((meta) => !banned.has(meta.slug))
    .map((meta) => ({ label: pathOf(meta.slug) || meta.title, value: meta.slug }))
  return [{ label: '（顶层）', value: TOP_LEVEL }, ...options]
})

/** 父页面下拉的值：顶层用哨兵值表示，后端那边是 null */
const parentValue = computed<string>({
  get: () => parentSlug.value ?? TOP_LEVEL,
  set: (value) => {
    parentSlug.value = value === TOP_LEVEL ? null : value
  },
})

/** 标签：界面上是逗号分隔的字符串，存进后端是数组 */
const parseTags = (text: string): string[] =>
  text
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')

/** 当前标签规范化后的形式（用来比较有没有改动） */
const currentTags = computed(() => parseTags(tagsText.value))

/** 有没有改动 —— 决定「保存」按钮能不能点 */
const dirty = computed(() => {
  const original = saved.value
  if (!original) return false
  return (
    original.title !== title.value ||
    savedContent.value !== content.value ||
    original.parent !== parentSlug.value ||
    original.tags.join(',') !== currentTags.value.join(',')
  )
})

/** 读页面列表 */
const loadPages = async (): Promise<void> => {
  try {
    pages.value = await listWikiPages()
    listError.value = ''
  } catch (error) {
    listError.value = error instanceof Error ? error.message : String(error)
  }
  // 记下这次读的是哪个版本的数据 —— 激活时靠它比对要不要重载
  loadedRevision = wikiRevision.value
}

/** 打开一个页面（读正文，填进编辑区） */
const openPage = async (slug: string): Promise<void> => {
  try {
    const page = await readWikiPage(slug)
    currentSlug.value = page.slug
    title.value = page.title
    content.value = page.content
    tagsText.value = page.tags.join(', ')
    parentSlug.value = page.parent
    saved.value = {
      slug: page.slug,
      title: page.title,
      tags: [...page.tags],
      parent: page.parent,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    }
    savedContent.value = page.content
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

/** 保存当前页面 */
const save = async (): Promise<void> => {
  if (!currentSlug.value) return
  try {
    await saveWikiPage(
      currentSlug.value,
      title.value.trim(),
      content.value,
      currentTags.value,
      parentSlug.value,
    )
    message.success('已保存')
    // 标题改了树上也要跟着变 —— 重新拉一次列表
    await loadPages()
    await openPage(currentSlug.value)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

/**
 * 把当前页面发布成 skill。
 *
 * skill 本质就是「agent 可读的 Markdown」—— 发布之后就能在 Skills 页绑到
 * 智能体上，不用在两个地方写一遍同样的内容。
 */
const publishAsSkill = async (): Promise<void> => {
  if (!currentSlug.value) return
  try {
    const info = await publishWikiAsSkill(currentSlug.value)
    message.success(`已发布为 skill：${info.name}`)
    // Skills 页被 KeepAlive 缓存着，切回去不会重新加载 ——
    // 告诉它「数据变了」。
    bumpSkills()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

/** 打开新建弹窗 */
const openCreate = (): void => {
  createTitle.value = ''
  createParent.value = TOP_LEVEL
  createOpen.value = true
}

/** 新建页面 */
const create = async (): Promise<void> => {
  const name = createTitle.value.trim()
  if (!name) {
    message.warning('先给页面起个标题')
    return
  }
  try {
    const page = await createWikiPage(
      name,
      createParent.value === TOP_LEVEL ? null : createParent.value,
    )
    createOpen.value = false
    await loadPages()
    await openPage(page.slug)
    message.success(`已创建：${page.title}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

/** 真正删掉页面 */
const confirmDelete = async (): Promise<void> => {
  const target = deleteTarget.value
  if (!target) return
  try {
    await deleteWikiPage(target.slug)
    deleteTarget.value = null
    if (currentSlug.value === target.slug) {
      currentSlug.value = ''
      saved.value = null
      savedContent.value = ''
      title.value = ''
      content.value = ''
      tagsText.value = ''
      parentSlug.value = null
    }
    await loadPages()
    message.success(`已删除：${target.title}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

/** 搜索（后端在正文里全文找，前端不做过滤） */
const runSearch = async (): Promise<void> => {
  const keyword = query.value.trim()
  if (!keyword) {
    hits.value = []
    searching.value = false
    return
  }
  searching.value = true
  try {
    hits.value = await searchWiki(keyword)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    hits.value = []
  } finally {
    searching.value = false
  }
}

/** 搜索词变化后延迟一下再查 —— 边打字边查会把磁盘翻烂 */
let searchTimer: number | undefined
watch(query, () => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void runSearch()
  }, 250)
})

onMounted(() => {
  void loadPages()
})

/**
 * 切回这个页面时看看要不要重新加载。
 *
 * 这个页面被 KeepAlive 缓存着（切走不卸载），所以**不会**再触发 onMounted。
 * 数据可能从别的页面变 —— 目前只有设置页导入备份会带进新的 Wiki 页面，
 * 那时候会 +1 版本号，这里比对到变了才重新加载。
 */
onActivated(() => {
  if (wikiRevision.value === loadedRevision) return
  void loadPages()
})
</script>

<template>
  <section class="wiki">
    <!-- 左栏：搜索 + 页面树 -->
    <aside class="side">
      <div class="side-head">
        <NInput v-model:value="query" size="small" clearable placeholder="搜索标题与正文">
          <template #prefix>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
        </NInput>
      </div>

      <div class="side-body">
        <!-- 搜索结果：有关键词时先显示结果，点结果直接进对应页 -->
        <ul v-if="query.trim()" class="hits">
          <li v-if="searching" class="hits-empty">搜索中…</li>
          <li v-else-if="!hits.length" class="hits-empty">没有匹配的页面</li>
          <li v-for="hit in hits" :key="`${hit.slug}-${hit.line}`" class="hit">
            <button type="button" class="hit-main" @click="openPage(hit.slug)">
              <span class="hit-title">{{ hit.title }}</span>
              <EllipsisText class="hit-snippet" :text="hit.snippet" />
              <span class="hit-line tnum">第 {{ hit.line }} 行</span>
            </button>
          </li>
        </ul>

        <template v-else>
          <p v-if="listError" class="side-error" role="alert">{{ listError }}</p>
          <p v-else-if="!treeRows.length" class="side-empty">
            还没有页面 —— 点下面「新建页面」写一篇
          </p>

          <ul class="tree">
            <li v-for="row in treeRows" :key="row.meta.slug">
              <div
                class="node"
                :class="{ active: row.meta.slug === currentSlug }"
                :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
              >
                <button
                  v-if="row.hasChildren"
                  type="button"
                  class="node-toggle"
                  :aria-label="row.expanded ? '折叠' : '展开'"
                  @click="toggleNode(row.meta.slug)"
                >
                  <ChevronDown v-if="row.expanded" :size="13" />
                  <ChevronRight v-else :size="13" />
                </button>
                <span v-else class="node-toggle node-toggle-empty" aria-hidden="true" />

                <button type="button" class="node-main" @click="openPage(row.meta.slug)">
                  <FileText :size="13" class="node-icon" aria-hidden="true" />
                  <EllipsisText class="node-title" :text="row.meta.title" />
                </button>

                <span v-if="row.meta.tags.length" class="node-tags">
                  <span v-for="tag in row.meta.tags" :key="tag" class="node-tag">{{ tag }}</span>
                </span>
              </div>
            </li>
          </ul>
        </template>
      </div>

      <div class="side-foot">
        <NButton size="small" block @click="openCreate">
          <template #icon>
            <NIcon :size="13">
              <Plus />
            </NIcon>
          </template>
          新建页面
        </NButton>
      </div>
    </aside>

    <!-- 右栏：标题 + 元信息 + 编辑/预览 -->
    <main class="main">
      <template v-if="currentSlug">
        <header class="main-head">
          <NInput v-model:value="title" class="title-input" placeholder="页面标题" />
          <NButton size="small" type="primary" :disabled="!dirty" @click="save">保存</NButton>
          <NButton size="small" secondary @click="publishAsSkill">发布为 skill</NButton>
          <NButton size="small" type="error" secondary @click="deleteTarget = saved">
            <template #icon>
              <NIcon :size="13">
                <Trash2 />
              </NIcon>
            </template>
            删除
          </NButton>
        </header>

        <div class="meta-row">
          <label class="meta-field">
            <span class="meta-label">父页面</span>
            <NSelect
              v-model:value="parentValue"
              size="small"
              class="parent-select"
              :options="parentOptions"
            />
          </label>

          <label class="meta-field">
            <span class="meta-label">标签</span>
            <NInput
              v-model:value="tagsText"
              size="small"
              class="tags-input"
              placeholder="用逗号分隔，如：部署, 运维"
            />
          </label>
        </div>

        <!-- 编辑区 + 实时预览（跟 skill 编辑器共用同一个组件） -->
        <MarkdownEditor v-model="content" class="panes" placeholder="用 Markdown 写正文…" />
      </template>

      <!-- 没打开页面时的空态 -->
      <div v-else class="blank">
        <NIcon :size="26" class="blank-icon">
          <BookOpen />
        </NIcon>
        <p class="blank-text">选一个页面开始编辑，或者新建一篇</p>
      </div>
    </main>

    <!-- 新建页面 -->
    <NModal
      v-model:show="createOpen"
      preset="card"
      style="width: 360px"
      :bordered="false"
      title="新建页面"
    >
      <label class="meta-field meta-field-block">
        <span class="meta-label">标题</span>
        <NInput v-model:value="createTitle" placeholder="页面标题" @keydown.enter="create" />
      </label>

      <label class="meta-field meta-field-block">
        <span class="meta-label">父页面</span>
        <NSelect
          v-model:value="createParent"
          size="small"
          :options="[
            { label: '（顶层）', value: TOP_LEVEL },
            ...pages.map((meta) => ({ label: pathOf(meta.slug) || meta.title, value: meta.slug })),
          ]"
        />
      </label>

      <div class="modal-actions">
        <NButton size="small" @click="createOpen = false">取消</NButton>
        <NButton size="small" type="primary" @click="create">创建</NButton>
      </div>
    </NModal>

    <!-- 删除确认 -->
    <NModal
      :show="deleteTarget !== null"
      preset="card"
      style="width: 360px"
      :bordered="false"
      title="删除页面"
      @update:show="(show: boolean) => !show && (deleteTarget = null)"
    >
      <p class="confirm-text">
        确定要删除 <strong>{{ deleteTarget?.title }}</strong> 吗？该操作不可撤销。
      </p>
      <div class="modal-actions">
        <NButton size="small" @click="deleteTarget = null">取消</NButton>
        <NButton size="small" type="error" @click="confirmDelete">删除</NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
/*
 * 整页不滚动：左栏的树、右栏的编辑区各自滚，
 * 页面本身保持在一屏内（像 IDE 那样）。
 */
.wiki {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* ---------- 左栏 ---------- */
.side {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 260px;
  border-right: 1px solid var(--c-border);
  background: var(--c-surface);
}

.side-head {
  flex: none;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--c-border);
}

.side-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 滚动条留固定位置：出现/消失时内容宽度不跳 */
  scrollbar-gutter: stable vertical;
}

.side-empty,
.side-error,
.hits-empty {
  margin: 0;
  padding: 24px 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
  text-align: center;
}

.side-error {
  color: var(--c-danger);
}

.side-foot {
  flex: none;
  padding: 8px 12px 12px;
  border-top: 1px solid var(--c-border);
}

/* ---------- 页面树 ---------- */
.tree {
  margin: 0;
  padding: 6px 0;
  list-style: none;
}

.node {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding-right: 10px;
  cursor: pointer;
}

.node:hover {
  background: var(--c-surface-sunken);
}

.node.active {
  background: var(--c-surface-sunken);
}

.node.active .node-title {
  font-weight: 600;
  color: var(--c-text-strong);
}

.node-toggle {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  color: var(--c-text-3);
  background: none;
  border: none;
}

/* 没有子节点的位置留空，标题才能对齐 */
.node-toggle-empty {
  width: 16px;
}

.node-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 0;
  color: var(--c-text);
  text-align: left;
  background: none;
  border: none;
}

.node-icon {
  flex: none;
  color: var(--c-text-4);
}

.node-title {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-tags {
  display: flex;
  flex: none;
  gap: 3px;
}

.node-tag {
  max-width: 56px;
  overflow: hidden;
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}

/* ---------- 搜索结果 ---------- */
.hits {
  margin: 0;
  padding: 6px 0;
  list-style: none;
}

.hit-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  background: none;
  border: none;
}

.hit-main:hover {
  background: var(--c-surface-sunken);
}

.hit-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
}

.hit-snippet {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-line {
  font-size: 10px;
  color: var(--c-text-4);
}

/* ---------- 右栏 ---------- */
.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.main-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border);
}

.title-input {
  flex: 1;
  min-width: 0;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
  padding: 8px 16px;
  border-bottom: 1px solid var(--c-border);
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-field-block {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  margin-bottom: 12px;
}

.meta-label {
  flex: none;
  font-size: 11px;
  color: var(--c-text-3);
}

.parent-select {
  width: 180px;
}

.tags-input {
  width: 240px;
}

/* 编辑区 + 预览（组件自己的样式在 MarkdownEditor 里，这里只管占位） */
.panes {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 没打开页面时的空态 */
.blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  color: var(--c-text-4);
}

.blank-text {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-3);
}

/* ---------- 弹窗 ---------- */
.confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
