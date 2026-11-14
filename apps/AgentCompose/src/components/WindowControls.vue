<script setup lang="ts">
/**
 * 应用内窗口按钮（最小化 / 最大化 / 关闭）。
 *
 * Windows 上系统标题栏被关掉了（见 `api/window.ts`），这三个按钮顶替它。
 * 交互跟原生一致：
 * - 悬停变色，关闭按钮悬停是红的
 * - 双击顶栏空白处由 Tauri 自己处理（最大化/还原）
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-vue-next'

/** 当前是不是最大化状态（决定显示「最大化」还是「还原」） */
const maximized = ref(false)

let unlisten: (() => void) | undefined

const sync = async (): Promise<void> => {
  try {
    maximized.value = await getCurrentWindow().isMaximized()
  } catch {
    maximized.value = false
  }
}

const run = async (action: () => Promise<void>): Promise<void> => {
  try {
    await action()
  } catch (error) {
    console.error('窗口操作失败', error)
  }
}

const minimize = (): Promise<void> => run(() => getCurrentWindow().minimize())

const toggleMaximize = (): Promise<void> =>
  run(async () => {
    const win = getCurrentWindow()
    if (await win.isMaximized()) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
    await sync()
  })

const close = (): Promise<void> => run(() => getCurrentWindow().close())

onMounted(async () => {
  await sync()
  try {
    unlisten = await getCurrentWindow().onResized(() => void sync())
  } catch {
    // 监听不上无所谓：最大化按钮自己也会同步一次
  }
})

onBeforeUnmount(() => {
  unlisten?.()
  unlisten = undefined
})
</script>

<template>
  <div class="win-controls">
    <button type="button" class="win-btn" aria-label="最小化" @click="minimize">
      <Minus :size="14" />
    </button>
    <button
      type="button"
      class="win-btn"
      :aria-label="maximized ? '还原' : '最大化'"
      @click="toggleMaximize"
    >
      <Copy v-if="maximized" :size="12" />
      <Square v-else :size="11" />
    </button>
    <button type="button" class="win-btn close" aria-label="关闭" @click="close">
      <X :size="14" />
    </button>
  </div>
</template>

<style scoped>
/*
 * 跟 Windows 11 原生标题栏按钮对齐：46×32 的点击区，图标居中。
 * 顶栏右侧本来有 16px 内边距，这里用负外边距把它抵掉，
 * 让按钮贴着窗口右边（跟系统标题栏一样）。
 */
.win-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  margin-right: -16px;
}

.win-btn {
  display: grid;
  place-items: center;
  width: 46px;
  height: 100%;
  padding: 0;
  color: var(--c-text-2);
  background: transparent;
  border: 0;
}

.win-btn:hover {
  color: var(--c-text);
  background: rgba(28, 28, 26, 0.06);
}

.win-btn.close:hover {
  color: #ffffff;
  background: #c42b1c;
}
</style>
