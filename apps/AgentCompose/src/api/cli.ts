import { invoke } from '@tauri-apps/api/core'

/** `agentspace` 命令行的安装状态 */
export interface CliStatus {
  /** 命令垫片在不在 */
  installed: boolean
  /** 垫片的绝对路径 */
  path: string | null
  /** 命令名 */
  command: string
}

/**
 * 查命令行工具的安装状态。
 *
 * 桌面端启动时会把垫片写进 PATH 目录；用户敲不到命令时要能在这里查。
 */
export async function getCliStatus(): Promise<CliStatus> {
  return await invoke<CliStatus>('cli_status')
}
