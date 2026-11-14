/**
 * 窗口外壳相关的 Tauri command 封装。
 *
 * Windows 上系统标题栏跟应用内容是两套东西：上面一条系统栏（带重复的应用名），
 * 下面一条应用自己的顶栏，两边对不齐。跟 cc-switch 一样的做法是
 * 关掉系统标题栏，让应用自己画标题栏（见 `components/WindowControls.vue`）。
 *
 * 后端返回「当前平台是不是应用内标题栏」，前端据此决定要不要画窗口按钮。
 */
import { invoke } from '@tauri-apps/api/core'

/** 是否使用应用内标题栏（Windows 为 true，macOS/Linux 保留系统标题栏） */
export const customTitlebar = (): Promise<boolean> => invoke<boolean>('custom_titlebar')
