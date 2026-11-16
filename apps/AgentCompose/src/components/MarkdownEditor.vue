<script setup lang="ts">
/**
 * Markdown 编辑器（左写右看）。
 *
 * 两边用同一个 v-model —— 左边改，右边实时更新。
 *
 * 预览**不用** md-editor-v3 自带的，那个不过 DOMPurify：
 * 远端来的 Markdown 渲染成 HTML 会有 XSS 风险。
 * 这里用项目自己的 MarkdownView（marked + DOMPurify）渲染，输出才安全。
 */
import { MdEditor, type ToolbarNames } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

import MarkdownView from '@/components/MarkdownView.vue'

const props = withDefaults(
  defineProps<{
    /** Markdown 源码 */
    modelValue?: string
    /** 占位提示 */
    placeholder?: string
    /** 工具栏按钮 */
    toolbars?: ToolbarNames[]
  }>(),
  {
    modelValue: '',
    placeholder: '用 Markdown 写…',
    toolbars: () => [
      'bold',
      'italic',
      'strikeThrough',
      'title',
      'quote',
      'unorderedList',
      'orderedList',
      'task',
      'codeRow',
      'code',
      'link',
      'table',
      'revoke',
      'next',
      '-',
      'fullscreen',
    ],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** 编辑区的值变化 → 往外抛 */
const onUpdate = (value: string): void => {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="markdown-editor">
    <div class="pane pane-editor">
      <MdEditor
        :model-value="props.modelValue"
        class="md-host"
        :preview="false"
        :footers="[]"
        :toolbars="props.toolbars"
        :no-upload-img="true"
        :placeholder="props.placeholder"
        @update:model-value="onUpdate"
      />
    </div>
    <div class="pane pane-preview">
      <div class="pane-title">实时预览</div>
      <div class="preview-scroll">
        <MarkdownView :source="props.modelValue" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.markdown-editor {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  overflow: hidden;
}

.pane-editor {
  background: var(--c-surface);
}

.pane-title {
  padding: 8px 12px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-3);
}

.preview-scroll {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  background: var(--c-surface);
}

/* md-editor-v3 自己的高度是按内容算的 —— 这里要撑满格子 */
.md-host {
  flex: 1;
  min-height: 0;
}
</style>
