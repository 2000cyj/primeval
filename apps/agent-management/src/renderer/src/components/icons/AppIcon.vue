<script setup lang="ts">
// 统一的内联 SVG 图标：24 viewBox、stroke 1.8。
// 图标路径与原型（Figma Make 发布版）逐一对齐，保持线性风格与描边粗细一致。
type IconShape =
  | { type: 'path'; d: string }
  | { type: 'rect'; x: number; y: number; width: number; height: number; rx: number }
  | { type: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }

const props = withDefaults(
  defineProps<{
    name: string
    size?: number
  }>(),
  { size: 18 },
)

const ICONS: Record<string, IconShape[]> = {
  // 品牌与导航
  agent: [
    { type: 'path', d: 'M8.4 4.8 12 2.7l3.6 2.1v4.1L12 11 8.4 8.9V4.8Z' },
    { type: 'path', d: 'm5.1 10.6 3.6-2.1 3.6 2.1v4.1l-3.6 2.1-3.6-2.1v-4.1Z' },
    { type: 'path', d: 'm11.7 10.6 3.6-2.1 3.6 2.1v4.1l-3.6 2.1-3.6-2.1v-4.1Z' },
  ],
  grid: [
    { type: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 2 },
    { type: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 2 },
    { type: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 2 },
    { type: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 2 },
  ],
  skill: [
    { type: 'path', d: 'M12 3 3.8 7.4 12 12l8.2-4.6L12 3Z' },
    { type: 'path', d: 'm5 11 7 4 7-4' },
    { type: 'path', d: 'm5 15 7 4 7-4' },
  ],
  server: [
    { type: 'rect', x: 3, y: 4, width: 18, height: 6, rx: 2 },
    { type: 'rect', x: 3, y: 14, width: 18, height: 6, rx: 2 },
    { type: 'path', d: 'M7 7h.01M7 17h.01M11 7h6M11 17h6' },
  ],
  workflow: [
    { type: 'rect', x: 3, y: 3, width: 6, height: 6, rx: 2 },
    { type: 'rect', x: 15, y: 15, width: 6, height: 6, rx: 2 },
    { type: 'path', d: 'M9 6h3a3 3 0 0 1 3 3v6M15 18h-3a3 3 0 0 1-3-3v-2' },
  ],
  chart: [{ type: 'path', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }],
  settings: [
    { type: 'circle', cx: 12, cy: 12, r: 3 },
    {
      type: 'path',
      d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z',
    },
  ],
  // 通用动作
  search: [
    { type: 'circle', cx: 11, cy: 11, r: 7 },
    { type: 'path', d: 'm20 20-4-4' },
  ],
  plus: [{ type: 'path', d: 'M12 5v14M5 12h14' }],
  filter: [{ type: 'path', d: 'M4 6h16M7 12h10M10 18h4' }],
  dots: [
    { type: 'circle', cx: 5, cy: 12, r: 1, fill: true },
    { type: 'circle', cx: 12, cy: 12, r: 1, fill: true },
    { type: 'circle', cx: 19, cy: 12, r: 1, fill: true },
  ],
  chevron: [{ type: 'path', d: 'm9 18 6-6-6-6' }],
  check: [{ type: 'path', d: 'm5 12 4 4L19 6' }],
  x: [{ type: 'path', d: 'm6 6 12 12M18 6 6 18' }],
  edit: [
    { type: 'path', d: 'm4 16-.8 4 4-.8L18.5 7.9a2.1 2.1 0 0 0-3-3L4 16Z' },
    { type: 'path', d: 'm14 6 4 4' },
  ],
  trash: [{ type: 'path', d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6' }],
  copy: [
    { type: 'rect', x: 8, y: 8, width: 12, height: 12, rx: 2 },
    { type: 'path', d: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' },
  ],
  refresh: [
    { type: 'path', d: 'M20 6v5h-5' },
    { type: 'path', d: 'M18.5 15a7.5 7.5 0 1 1-.7-7.2L20 11' },
  ],
  clock: [
    { type: 'circle', cx: 12, cy: 12, r: 9 },
    { type: 'path', d: 'M12 7v5l3 2' },
  ],
  bell: [{ type: 'path', d: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4' }],
  // 能力图标
  book: [
    { type: 'path', d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z' },
    { type: 'path', d: 'M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z' },
  ],
  code: [{ type: 'path', d: 'm8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14' }],
  database: [
    { type: 'ellipse', cx: 12, cy: 5, rx: 8, ry: 3 },
    { type: 'path', d: 'M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6' },
  ],
  image: [
    { type: 'rect', x: 3, y: 4, width: 18, height: 16, rx: 3 },
    { type: 'circle', cx: 9, cy: 10, r: 2 },
    { type: 'path', d: 'm21 15-4.5-4.5L7 20' },
  ],
  globe: [
    { type: 'circle', cx: 12, cy: 12, r: 9 },
    { type: 'path', d: 'M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18' },
  ],
  folder: [
    {
      type: 'path',
      d: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    },
  ],
  terminal: [
    { type: 'path', d: 'm6 8 4 4-4 4M13 16h5' },
    { type: 'rect', x: 3, y: 4, width: 18, height: 16, rx: 3 },
  ],
  figma: [
    {
      type: 'path',
      d: 'M9 3h3v6H9a3 3 0 1 1 0-6ZM12 3h3a3 3 0 1 1 0 6h-3V3ZM9 9h3v6H9a3 3 0 1 1 0-6ZM12 9h3a3 3 0 1 1-3 3V9ZM9 15h3v3a3 3 0 1 1-3-3Z',
    },
  ],
  slack: [
    {
      type: 'path',
      d: 'M9.5 3a2 2 0 0 1 0 4H7V5a2 2 0 0 1 2.5-2ZM11 9.5a2 2 0 0 1 2-2h2v4h-2a2 2 0 0 1-2-2ZM21 9.5a2 2 0 0 1-4 0V7h2a2 2 0 0 1 2 2.5ZM14.5 11a2 2 0 0 1 2 2v2h-4v-2a2 2 0 0 1 2-2ZM14.5 21a2 2 0 0 1 0-4H17v2a2 2 0 0 1-2.5 2ZM13 14.5a2 2 0 0 1-2 2H9v-4h2a2 2 0 0 1 2 2ZM3 14.5a2 2 0 0 1 4 0V17H5a2 2 0 0 1-2-2.5ZM9.5 13a2 2 0 0 1-2-2V9h4v2a2 2 0 0 1-2 2Z',
    },
  ],
  // 其余页面仍在使用的图标
  bot: [
    { type: 'path', d: 'M12 8V4H8' },
    { type: 'path', d: 'M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z' },
    { type: 'path', d: 'M9 14h.01M15 14h.01' },
  ],
  sliders: [
    { type: 'path', d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4' },
  ],
  'chevron-down': [{ type: 'path', d: 'M6 9l6 6 6-6' }],
  sparkles: [
    { type: 'path', d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z' },
    { type: 'path', d: 'M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z' },
  ],
  cursor: [{ type: 'path', d: 'M3 3l7.5 17 2.3-7.2L20 10.5z' }],
  box: [
    { type: 'path', d: 'M21 8l-9-5-9 5v8l9 5 9-5z' },
    { type: 'path', d: 'M3.3 8.3 12 13l8.7-4.7' },
    { type: 'path', d: 'M12 22V13' },
  ],
  monitor: [
    { type: 'path', d: 'M2 5h20v14H2z' },
    { type: 'path', d: 'M8 21h8M12 19v2' },
  ],
  'trending-up': [
    { type: 'path', d: 'M22 7l-8.5 8.5-5-5L2 17' },
    { type: 'path', d: 'M16 7h6v6' },
  ],
  laptop: [
    { type: 'path', d: 'M3 4h18v12H3z' },
    { type: 'path', d: 'M2 20h20' },
  ],
  shield: [{ type: 'path', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }],
  plug: [
    { type: 'path', d: 'M12 22v-5' },
    { type: 'path', d: 'M9 8V2M15 8V2' },
    { type: 'path', d: 'M6 8h12v4a6 6 0 0 1-12 0V8z' },
  ],
  info: [
    { type: 'circle', cx: 12, cy: 12, r: 9 },
    { type: 'path', d: 'M12 8h.01M11 12h1v4h1' },
  ],
  timer: [
    { type: 'path', d: 'M10 2h4' },
    { type: 'path', d: 'M12 14l3-3' },
    { type: 'circle', cx: 12, cy: 14, r: 8 },
  ],
  palette: [
    {
      type: 'path',
      d: 'M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-2a2 2 0 0 0-2 2c0 1 .6 1.6.6 2.6 0 .8-.8 1.4-2.6 1.4z',
    },
    { type: 'path', d: 'M7.5 11h.01M10 7.5h.01M14 7h.01M16.5 10h.01' },
  ],
  'git-branch': [
    { type: 'path', d: 'M6 3v12' },
    { type: 'circle', cx: 6, cy: 18, r: 3 },
    { type: 'circle', cx: 18, cy: 6, r: 3 },
    { type: 'path', d: 'M18 9a9 9 0 0 1-9 9' },
  ],
  message: [{ type: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
  browser: [
    { type: 'path', d: 'M3 4h18v16H3z' },
    { type: 'path', d: 'M3 9h18' },
    { type: 'path', d: 'M6.5 6.5h.01M9.5 6.5h.01' },
  ],
  file: [
    { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
    { type: 'path', d: 'M14 2v6h6' },
  ],
}

const shapes = (): IconShape[] => ICONS[props.name] ?? []
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-for="(shape, index) in shapes()" :key="index">
      <path v-if="shape.type === 'path'" :d="shape.d" />
      <rect
        v-else-if="shape.type === 'rect'"
        :x="shape.x"
        :y="shape.y"
        :width="shape.width"
        :height="shape.height"
        :rx="shape.rx"
      />
      <circle
        v-else-if="shape.type === 'circle'"
        :cx="shape.cx"
        :cy="shape.cy"
        :r="shape.r"
        :fill="shape.fill ? 'currentColor' : 'none'"
        :stroke="shape.fill ? 'none' : 'currentColor'"
      />
      <ellipse v-else :cx="shape.cx" :cy="shape.cy" :rx="shape.rx" :ry="shape.ry" />
    </template>
  </svg>
</template>
