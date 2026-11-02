import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS, isAllowedChannel, type DesktopBridge } from '../shared/channels'

// 桥接方法 → IPC 频道的唯一映射。渲染层只能通过这些具名方法访问主进程。
const BRIDGE_CHANNELS = {
  getAppVersion: IPC_CHANNELS.appVersion,
} as const

// 启动期自检:桥接用到的每个频道都必须在白名单内,漏改白名单时直接启动失败
for (const channel of Object.values(BRIDGE_CHANNELS)) {
  if (!isAllowedChannel(channel)) {
    throw new Error(`[desktop] 拒绝暴露非白名单 IPC 频道: ${channel}`)
  }
}

// 只暴露具名方法,不暴露 ipcRenderer / require / process 等通用能力
const bridge: DesktopBridge = {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke(BRIDGE_CHANNELS.getAppVersion) as Promise<string>,
}

contextBridge.exposeInMainWorld('desktop', bridge)
