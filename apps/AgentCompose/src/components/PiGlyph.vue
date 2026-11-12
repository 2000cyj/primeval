<script setup lang="ts">
/**
 * Pi 的标志。
 *
 * 用内联 svg 而不是 `<img>` —— 图标要跟着文字颜色走（`currentColor`），
 * 而 `<img>` 里的 svg 拿不到外层的 color。
 *
 * 形状取自 cc-switch 的 `pi.svg`（MIT）：三个方块拼成的「π」，
 * 这里是单色描边版 —— 侧边栏是深色底，实心的彩色块看不清。
 *
 * 线宽按 800 视口算：56 在 15px 下只有 1.05px，比 lucide 的 2px 细。
 * 96 缩到 15px 刚好 1.8px，和其他图标看起来一样重。
 */
withDefaults(defineProps<{ size?: number }>(), { size: 15 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 800 800"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <title>Pi</title>
    <path
      d="M165.29 165.29H517.36V400H400V282.65H165.29ZM165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29ZM517.36 400H634.72V634.72H517.36Z"
      fill="none"
      stroke="currentColor"
      stroke-width="96"
      stroke-linejoin="miter"
    />
  </svg>
</template>
