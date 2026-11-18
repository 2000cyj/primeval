<script setup lang="ts">
/**
 * 会截断的文本 —— **真的被截断了**才在鼠标移上去时显示全文。
 *
 * # 为什么要有这个
 *
 * 表格里很多内容是长文本：skill 的描述、扩展的安装路径、MCP 的地址、
 * wiki 的正文片段……它们被 `text-overflow: ellipsis` 截断后，
 * **用户完全看不到后面是什么** —— 想知道就得去别的页面翻。
 *
 * 朴素做法是给每处都套一个 `NTooltip`，但有两个问题：
 * - 二十多处重复，且每处都要自己判断「该不该显示提示」
 * - 不管有没有被截断都弹提示 —— 一段刚好放得下的文字，鼠标移上去也冒出个框
 *
 * 这里统一处理：**量一下是不是真的被截断**（`scrollWidth > clientWidth`），
 * 没截断就不显示提示。
 *
 * # 用法
 *
 * ```vue
 * <EllipsisText class="cell-desc" :text="skill.description" />
 * ```
 *
 * `class` 会落到组件的根元素上 —— 也就是承载文字的那个 `span`。
 * 因为它是组件的根节点，**父组件的 scoped 样式照常作用**（字号、颜色那些
 * 不用改），组件自己只负责「要不要提示」和「提示里显示什么」。
 *
 * # 为什么 `inheritAttrs: false`
 *
 * 根节点是 `NTooltip`，而它内部（Popover）渲染出来是**多个根节点** ——
 * Vue 遇到多根节点会**丢弃**透传属性，`class` 就丢了，父组件的 scoped 样式
 * 跟着失效（字号、颜色全变成默认的）。
 *
 * 所以这里关掉自动透传，改为**显式**把 `$attrs` 绑到承载文字的 `span` 上 ——
 * 它是本组件真正的根元素，父组件的 scope id 也在它身上，样式才生效。
 */
import { NTooltip } from 'naive-ui'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// 透传属性要自己绑（见上面「为什么 inheritAttrs: false」）。
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** 要显示的文本（空 / null 都不显示） */
    text?: string | null
    /** 提示框的弹出位置 */
    placement?: 'top' | 'bottom' | 'left' | 'right'
  }>(),
  { text: '', placement: 'top' },
)

/** 承载文本的元素 —— 量它就知道截没截断。 */
const host = ref<HTMLElement | null>(null)
/** 是不是真的被截断了。 */
const truncated = ref(false)

/** 量一次：更新「有没有截断」。 */
const measure = (): void => {
  const node = host.value
  if (!node) return
  // +1 是留个余量 —— 亚像素取整会让刚好放得下的也判成截断
  truncated.value = node.scrollWidth > node.clientWidth + 1
}

/** 尺寸变了，截断状态可能跟着变。 */
let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(host.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// 文本变了（列表刷新）→ 重新量
watch(
  () => props.text,
  () => {
    void nextTick(measure)
  },
)
</script>

<template>
  <NTooltip :disabled="!truncated || !props.text" trigger="hover" :placement="props.placement">
    <template #trigger>
      <span ref="host" class="ellipsis-host" v-bind="$attrs">{{ props.text }}</span>
    </template>
    <span class="ellipsis-tip">{{ props.text }}</span>
  </NTooltip>
</template>

<style scoped>
/*
 * 承载文本的元素 —— 截断就发生在这里。
 *
 * `display: block` + `min-width: 0` 是关键：作为 flex / grid 的子项时，
 * 没有 `min-width: 0` 就不会被压窄，截断也就不会发生。
 */
.ellipsis-host {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 提示框里的文字 —— 长的要能换行，不能撑爆弹窗 */
.ellipsis-tip {
  display: block;
  max-width: 420px;
  line-height: 1.6;
  word-break: break-word;
}
</style>
