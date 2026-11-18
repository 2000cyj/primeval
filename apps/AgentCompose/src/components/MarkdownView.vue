<script setup lang="ts">
/**
 * Markdown 渲染。
 *
 * 发布说明是从 GitHub Release 正文来的 Markdown —— 里面有标题、列表、
 * 代码块、粗体。直接塞进 <pre> 显示就是一堆符号，看不出层次。
 *
 * 这里渲染成 HTML 再显示，并用 DOMPurify 洗一遍：
 * 内容来自远端，不能直接信。
 */
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { openExternal } from '@/api/extensions'

const props = withDefaults(
  defineProps<{
    /** Markdown 原文 */
    source?: string
  }>(),
  { source: '' },
)

/** 渲染并清洗后的 HTML */
const html = computed(() => {
  if (!props.source) return ''
  // marked 不在浏览器外用，这里同步解析够用（发布说明不长）
  const raw = marked.parse(props.source, { async: false, gfm: true, breaks: false })
  return DOMPurify.sanitize(raw, {
    // 保留 target="_blank" 的链接能新窗口打开
    ADD_ATTR: ['target'],
  })
})

/**
 * 点链接 —— 交给系统浏览器打开。
 *
 * 桌面端的 webview 不是浏览器，链接有两条路：
 * - 普通链接 → 导航守卫接管（应用不会被带走，链接交给系统浏览器）
 * - `target="_blank"` 的链接 → 走「新窗口请求」，webview 会静默拒绝，
 *   点了什么反应都没有
 *
 * 所以这里自己拦一层，统一交给系统浏览器处理。
 *
 * 只拦 http/https —— 相对链接（应用内部）不管，让它正常走。
 */
const onLinkClick = async (event: MouseEvent): Promise<void> => {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')
  if (!href || !/^https?:\/\//i.test(href)) return
  event.preventDefault()
  try {
    await openExternal(href)
  } catch {
    // 打不开就算了 —— 总比留一个点了没反应的链接强
  }
}
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- 已经过 DOMPurify 清洗 -->
  <div class="markdown" @click="onLinkClick" v-html="html" />
</template>

<style scoped>
/*
 * Markdown 渲染后的排版。
 *
 * 尺寸跟正文对齐（13px），标题比正文大但不像 h1 那样夸张 ——
 * 发布说明是在一个卡片里读的，不是文章页面。
 */
.markdown {
  font-size: 13px;
  line-height: 1.65;
  color: var(--c-text);
  word-break: break-word;
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--c-text-strong);
}

.markdown :deep(h1) {
  font-size: 15px;
}

.markdown :deep(h2) {
  font-size: 14px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--c-border);
}

.markdown :deep(h3) {
  font-size: 13px;
}

.markdown :deep(h4) {
  font-size: 13px;
  color: var(--c-text-2);
}

/* 第一个标题不留上边距 —— 卡片顶部不需要空一截 */
.markdown :deep(> :first-child) {
  margin-top: 0;
}

.markdown :deep(p) {
  margin: 8px 0;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.markdown :deep(li) {
  margin: 3px 0;
}

.markdown :deep(li > p) {
  margin: 3px 0;
}

.markdown :deep(strong) {
  font-weight: 600;
  color: var(--c-text-strong);
}

.markdown :deep(a) {
  color: var(--c-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 行内代码 */
.markdown :deep(code) {
  padding: 1px 4px;
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: 4px;
}

/* 代码块 */
.markdown :deep(pre) {
  margin: 10px 0;
  padding: 10px 12px;
  overflow-x: auto;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.markdown :deep(pre code) {
  padding: 0;
  font-size: 12px;
  line-height: 1.55;
  background: none;
  border: none;
}

/* 引用 */
.markdown :deep(blockquote) {
  margin: 10px 0;
  padding: 2px 0 2px 12px;
  color: var(--c-text-2);
  border-left: 3px solid var(--c-border-strong);
}

.markdown :deep(blockquote > :first-child) {
  margin-top: 0;
}

.markdown :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

/* 分隔线 */
.markdown :deep(hr) {
  margin: 14px 0;
  border: 0;
  border-top: 1px solid var(--c-border);
}

/* 表格 */
.markdown :deep(table) {
  margin: 10px 0;
  border-collapse: collapse;
  font-size: 12px;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--c-border);
  text-align: left;
}

.markdown :deep(th) {
  font-weight: 600;
  background: var(--c-surface-sunken);
}
</style>
