/**
 * 关掉 webview 的浏览器特性。
 *
 * 桌面端不该像个浏览器 —— 右键弹浏览器的菜单、Ctrl+P 弹打印、Ctrl+F 弹
 * 查找、Ctrl+R 刷新页面……这些在应用里全是「点了没反应」或者「把应用弄乱」
 * 的东西。
 *
 * # 为什么要在前端做
 *
 * WebView2 的这些行为分两层：
 *
 * | 行为 | 关掉的办法 |
 * |---|---|
 * | 浏览器扩展 | `WindowConfig.browserExtensionsEnabled`（配置里已关） |
 * | Ctrl+滚轮缩放 | `WindowConfig.zoomHotkeysEnabled`（配置里已关） |
 * | 外部导航 | 导航守卫插件（`src-tauri/src/navigation_guard.rs`） |
 * | **右键菜单** | 页面取消 `contextmenu` 事件 |
 * | **浏览器快捷键** | 页面在 `keydown` 里 `preventDefault` |
 *
 * 右键菜单和快捷键这两项，Tauri 没有透出对应的 WebView2 设置
 * （wry 有 `with_default_context_menus`，Tauri 没接），只能由页面自己拦 ——
 * 而这正好是 WebView2 的标准做法：页面取消 `contextmenu` 事件，WebView2
 * 就不弹它自带的菜单。
 *
 * # 开发版与发布版不一样的地方
 *
 * **F12 / Ctrl+Shift+I（开发者工具）在开发版保留** —— 调试时要看 DOM、看控制台。
 * 发布版拦掉：应用里按 F12 弹个开发者工具窗口出来，不像正常应用。
 *
 * 判据是 `import.meta.env.DEV`（Vite 的构建模式标记）—— 开发服务器和
 * 调试构建都是 true，正式构建是 false。
 *
 * # 不拦什么
 *
 * - **复制粘贴**（Ctrl+C / Ctrl+V）—— 要用
 * - **文字选中**、**拖动选区** —— 要用
 * - **Alt+F4** —— 系统级关窗口，不该拦
 * - **F11 全屏** —— 拦掉（应用自己 Maximize 就够了）
 * - **F12 开发者工具（仅开发版）** —— 调试要看
 */

/**
 * 要拦的浏览器快捷键。
 *
 * 判据是「按下时有没有 Ctrl / Alt / Shift 的修饰键」——
 * 光按 F 键的那些（F1 帮助、F5 刷新、F11 全屏、F12 开发者工具）单独列。
 */
type Modifier = 'ctrl' | 'alt' | 'meta' | 'shift'

const MODIFIER_SHORTCUTS: ReadonlyArray<{
  /** `event.key` 的小写值 */
  key: string
  /** 必须按下的修饰键 */
  modifiers: readonly Modifier[] | 'any-modifier'
}> = [
  // 浏览 / 查找 / 打印 / 保存
  { key: 'f', modifiers: ['ctrl'] },
  { key: 'e', modifiers: ['ctrl'] },
  { key: 'p', modifiers: ['ctrl'] },
  { key: 's', modifiers: ['ctrl'] },
  // 刷新 / 停止
  { key: 'r', modifiers: ['ctrl'] },
  { key: 'r', modifiers: ['ctrl', 'shift'] },
  // 新标签页 / 新窗口 / 关闭窗口
  { key: 't', modifiers: ['ctrl'] },
  { key: 't', modifiers: ['ctrl', 'shift'] },
  { key: 'n', modifiers: ['ctrl'] },
  { key: 'n', modifiers: ['ctrl', 'shift'] },
  { key: 'w', modifiers: ['ctrl'] },
  { key: 'w', modifiers: ['ctrl', 'shift'] },
  // 书签 / 历史 / 下载
  { key: 'd', modifiers: ['ctrl'] },
  { key: 'd', modifiers: ['ctrl', 'shift'] },
  { key: 'h', modifiers: ['ctrl'] },
  { key: 'j', modifiers: ['ctrl'] },
  { key: 'o', modifiers: ['ctrl'] },
  { key: 'o', modifiers: ['ctrl', 'shift'] },
  // 查看源代码
  { key: 'u', modifiers: ['ctrl'] },
  // 地址栏 / 搜索栏
  { key: 'l', modifiers: ['ctrl'] },
  { key: 'k', modifiers: ['ctrl'] },
  // 清除浏览数据
  { key: 'delete', modifiers: ['ctrl', 'shift'] },
  { key: 'backspace', modifiers: ['ctrl', 'shift'] },
]

/**
 * 不带修饰键、但同样是浏览器快捷键的按键。
 *
 * **不含 F12** —— 开发者工具的快捷键单独处理（见 `DEVTOOLS_SHORTCUTS`）。
 */
const PLAIN_KEYS: ReadonlySet<string> = new Set([
  'f5', // 刷新
  'f6', // 在地址栏间循环焦点
  'f10', // 菜单栏
  'f11', // 全屏
])

/**
 * 开发者工具的快捷键。
 *
 * **开发版保留** —— 调试时要看 DOM、看控制台。
 * **发布版拦掉** —— 应用里按 F12 弹一个开发者工具窗口出来，不像正常应用。
 *
 * 发布版本来也没有开发者工具（Tauri 的 `devtools` 是 cargo feature，
 * 我们没开）—— 但快捷键还是得拦，否则用户按了没反应，以为程序卡了。
 */
const DEVTOOLS_SHORTCUTS: ReadonlyArray<{
  key: string
  modifiers: readonly Modifier[] | 'none'
}> = [
  { key: 'f12', modifiers: 'none' },
  { key: 'i', modifiers: ['ctrl', 'shift'] },
  { key: 'i', modifiers: ['ctrl'] },
]

/** 修饰键是否对得上。 */
const modifiersMatch = (
  event: KeyboardEvent,
  expected: readonly Modifier[] | 'any-modifier' | 'none',
): boolean => {
  if (expected === 'none') {
    return !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
  }
  if (expected === 'any-modifier') {
    return event.ctrlKey || event.altKey || event.metaKey
  }
  const pressed = [
    event.ctrlKey ? 'ctrl' : null,
    event.altKey ? 'alt' : null,
    event.metaKey ? 'meta' : null,
    event.shiftKey ? 'shift' : null,
  ].filter((value): value is Modifier => value !== null)
  if (pressed.length !== expected.length) return false
  return expected.every((modifier) => pressed.includes(modifier))
}

/**
 * 这个按键是不是要拦的浏览器快捷键。
 *
 * @param isDev 开发模式？开发模式保留开发者工具快捷键（F12 等）。
 */
export const isBrowserShortcut = (event: KeyboardEvent, isDev = import.meta.env.DEV): boolean => {
  const key = event.key.toLowerCase()
  for (const shortcut of MODIFIER_SHORTCUTS) {
    if (shortcut.key === key && modifiersMatch(event, shortcut.modifiers)) {
      return true
    }
  }
  // 光按功能键的：F5 / F11 …
  if (PLAIN_KEYS.has(key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return true
  }
  // 开发者工具：只在发布版拦
  if (!isDev) {
    for (const shortcut of DEVTOOLS_SHORTCUTS) {
      if (shortcut.key === key && modifiersMatch(event, shortcut.modifiers)) {
        return true
      }
    }
  }
  // Alt+左右方向键 = 后退 / 前进
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (key === 'arrowleft' || key === 'arrowright')
  ) {
    return true
  }
  return false
}

/**
 * 装上拦截器。返回一个清理函数。
 *
 * 用捕获阶段（`true`）—— 页面里别的地方可能也监听 keydown，
 * 捕获阶段能保证我们先拦下来。
 */
export const disableBrowserFeatures = (): (() => void) => {
  // 右键菜单：WebView2 自带的那套（后退 / 前进 / 刷新 / 另存为 / 查看源代码…）
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }

  // 中键粘贴 —— 浏览器特性
  const onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault()
    }
  }

  // 浏览器快捷键
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isBrowserShortcut(event)) {
      event.preventDefault()
    }
  }

  // 拖文件进窗口：浏览器会直接打开那个文件
  const onDragOver = (event: DragEvent): void => {
    event.preventDefault()
  }
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
  }

  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('auxclick', onAuxClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('drop', onDrop, true)

  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('auxclick', onAuxClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('drop', onDrop, true)
  }
}
