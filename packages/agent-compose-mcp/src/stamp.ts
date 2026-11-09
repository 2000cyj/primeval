/**
 * 源码指纹：用于识别「运行中的 sidecar 是否还对应当前代码」。
 *
 * sidecar 是独立进程，改了代码不会自动生效 —— 开发时表现为
 * 「明明改了却没效果」。sidecar 启动时把自己的 pid 与源码指纹落盘，
 * 调用方据此判断要不要重启它。
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 源码目录里最新的修改时间（毫秒）。没有文件时返回 0。 */
export function sourceStamp(dir: string): number {
  let latest = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    if (!name.endsWith('.ts')) continue
    try {
      const stats = statSync(join(dir, name))
      const modified = stats.mtimeMs
      if (modified > latest) latest = modified
    } catch {
      // 单个文件读不到就跳过
    }
  }
  return Math.round(latest)
}

/** 落盘的运行信息 */
export type SidecarRuntimeInfo = {
  pid: number
  /** 启动时的源码指纹 */
  sourceStamp: number
  startedAt: string
}
