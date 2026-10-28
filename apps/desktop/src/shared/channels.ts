// main / preload / 类型契约共用的 IPC 频道声明。
// renderer 不直接引用本文件,只通过 preload 暴露的具名方法访问。

// 唯一允许暴露给 renderer 的通道清单,是白名单的唯一事实来源。
export const ALLOWED_CHANNELS = ['app:getVersion'] as const

export type IpcChannel = (typeof ALLOWED_CHANNELS)[number]

// 频道名常量必须落在 ALLOWED_CHANNELS 内,否则 `satisfies` 在编译期报错。
export const IPC_CHANNELS = {
  appVersion: 'app:getVersion',
} as const satisfies Record<string, IpcChannel>

// 运行时闸门:main / preload 两侧都过一遍,避免新增频道时漏改白名单。
export function isAllowedChannel(channel: string): channel is IpcChannel {
  return (ALLOWED_CHANNELS as readonly string[]).includes(channel)
}

export interface DesktopBridge {
  readonly platform: NodeJS.Platform
  getAppVersion: () => Promise<string>
}
