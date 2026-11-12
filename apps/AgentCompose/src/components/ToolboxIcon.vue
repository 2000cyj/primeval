<script setup lang="ts">
/**
 * 工具箱图标。
 *
 * 表示「工具箱」—— 也就是我们存放 npm 与自定义扩展的地方。
 * 位图（不是单色线框），所以不跟随文字颜色。
 */
import toolboxIcon from '@/assets/toolbox-icon.png'

withDefaults(defineProps<{ size?: number }>(), { size: 14 })
</script>

<template>
  <img
    class="toolbox-icon"
    :src="toolboxIcon"
    :width="size"
    :height="size"
    alt=""
    aria-hidden="true"
  />
</template>

<style scoped>
.toolbox-icon {
  display: block;
  flex: none;
  object-fit: contain;
}
</style>
