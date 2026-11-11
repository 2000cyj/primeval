/**
 * 全局出站代理的 Tauri command 封装。
 *
 * 对应「系统设置 › 网络 › 全局出站代理」那块 UI。
 * command 名一律取自 PROXY_COMMANDS，不在此处硬编码字符串。
 */
import { invoke } from '@tauri-apps/api/core'

export const PROXY_COMMANDS = {
  get: 'proxy_get',
  set: 'proxy_set',
  test: 'proxy_test',
  scan: 'proxy_scan',
} as const

/** 代理从哪儿来的 */
export type ProxySource = 'settings' | 'env' | 'unset'

/** 代理状态 */
export interface ProxyInfo {
  /** 用户保存的原始值；null = 从未设置，空串 = 强制直连 */
  savedUrl: string | null
  /** 当前实际生效的地址（密码已打码）；null = 直连 */
  effectiveUrl: string | null
  /** 来源：settings（全局设置）/ env（环境变量）/ unset（都没配） */
  source: ProxySource
}

/** 代理连通性测试结果 */
export interface ProxyTestResult {
  /** 是否连得上 */
  success: boolean
  /** 往返耗时（毫秒） */
  latencyMs: number
  /** 失败原因 */
  error: string | null
}

/** 扫到的本地代理 */
export interface DetectedProxy {
  /** 代理地址 */
  url: string
  /** 协议：http / socks5 */
  proxyType: string
  /** 端口 */
  port: number
}

/** 统一的错误包装：保留原始原因，便于界面直接展示 */
function fail(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${action}失败：${detail}`, { cause: error })
}

/** 读代理状态 */
export async function getProxy(): Promise<ProxyInfo> {
  try {
    return await invoke<ProxyInfo>(PROXY_COMMANDS.get)
  } catch (error) {
    throw fail('读取代理设置', error)
  }
}

/** 保存代理地址。传空串 = 强制直连。 */
export async function setProxy(url: string): Promise<ProxyInfo> {
  try {
    return await invoke<ProxyInfo>(PROXY_COMMANDS.set, { url })
  } catch (error) {
    throw fail('保存代理设置', error)
  }
}

/** 测试代理连通性 */
export async function testProxy(url: string): Promise<ProxyTestResult> {
  try {
    return await invoke<ProxyTestResult>(PROXY_COMMANDS.test, { url })
  } catch (error) {
    throw fail('测试代理', error)
  }
}

/** 扫本机常见端口上有没有代理在跑 */
export async function scanProxies(): Promise<DetectedProxy[]> {
  try {
    return await invoke<DetectedProxy[]>(PROXY_COMMANDS.scan)
  } catch (error) {
    throw fail('扫描本地代理', error)
  }
}
