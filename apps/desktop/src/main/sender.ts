import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 渲染层信任策略。两种互斥形态:
// - dev-server:开发态(electron-vite dev),只信本机 dev server 的 origin
// - local-file:非开发态(打包产物 / `electron .` 直接启动),只信实际入口文件
//
// 判定一律基于 URL 解析后的 hostname / port / 文件路径,不做字符串前缀匹配,
// 避免 http://localhost:5173@evil.com/ 这类 userinfo 绕过。
export type SenderPolicy =
  | { readonly kind: 'dev-server'; readonly origin: string }
  | { readonly kind: 'local-file'; readonly filePath: string }

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname)
}

function effectivePort(url: URL): string {
  if (url.port) return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

function normalizeFsPath(target: string): string {
  const resolved = path.resolve(target)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isTrustedSender(rawUrl: string | undefined, policy: SenderPolicy): boolean {
  if (!rawUrl) return false

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (policy.kind === 'dev-server') {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    // 带 userinfo 的地址一律拒绝(http://localhost:5174@evil.com/ 的真实 host 是 evil.com)
    if (url.username !== '' || url.password !== '') return false
    if (!isLoopbackHostname(url.hostname)) return false

    let dev: URL
    try {
      dev = new URL(policy.origin)
    } catch {
      return false
    }
    if (!isLoopbackHostname(dev.hostname)) return false
    return effectivePort(url) === effectivePort(dev)
  }

  if (url.protocol !== 'file:') return false

  let filePath: string
  try {
    filePath = fileURLToPath(url)
  } catch {
    return false
  }
  return normalizeFsPath(filePath) === normalizeFsPath(policy.filePath)
}
