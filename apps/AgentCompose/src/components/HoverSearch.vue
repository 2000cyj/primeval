<script setup lang="ts">
/**
 * 悬停展开的搜索框。
 *
 * 默认只显示一个放大镜图标（省地方），鼠标移上去或点进去才展开成完整输入框。
 * 展开状态下用 :focus-within 保持，键盘 Tab 进来也能用。
 */
import { ref } from 'vue'
import { NIcon, NInput } from 'naive-ui'
import { Search } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /** 输入值 */
    modelValue: string
    /** 展开后显示的提示文案 */
    placeholder?: string
    /** 展开后的宽度 */
    width?: number
  }>(),
  { placeholder: '搜索', width: 200 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** 是否展开（鼠标悬停或聚焦中） */
const open = ref(false)

/** 聚焦中：鼠标移走也不收起 */
const focused = ref(false)

const onEnter = (): void => {
  open.value = true
}

const onLeave = (): void => {
  if (!focused.value) open.value = false
}
</script>

<template>
  <div
    class="hover-search"
    :class="{ open }"
    :style="{ '--search-width': `${props.width}px` }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <NInput
      :value="props.modelValue"
      size="small"
      clearable
      :placeholder="open ? props.placeholder : ''"
      @update:value="emit('update:modelValue', $event)"
    >
      <template #prefix>
        <NIcon :size="14">
          <Search />
        </NIcon>
      </template>
    </NInput>
  </div>
</template>

<style scoped>
/*
 * 收起时只占一个图标位（30px），展开时撑到 --search-width。
 * 宽度过渡放在这里，展开/收起都有动画。
 */
.hover-search {
  width: 30px;
  flex: none;
  transition: width 0.18s ease;
}

.hover-search.open {
  width: var(--search-width);
}

/* 收起状态下不显示输入文字，避免溢出到图标上 */
.hover-search:not(.open) :deep(.n-input__input-el) {
  color: transparent;
}
</style>
