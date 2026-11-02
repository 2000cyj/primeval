import { session, type BrowserWindow } from 'electron'

import { isTrustedSender, type SenderPolicy } from './sender'

// 默认拒绝所有权限请求(摄像头、麦克风、通知、地理位置等),本轮桌面壳无任何权限需求
export function hardenSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  ses.setPermissionCheckHandler(() => false)
}

// 禁止新开窗口、禁止 webview、禁止导航到非本应用页面。
// 导航白名单与 IPC sender 校验共用同一份策略,避免两处口径漂移。
export function guardNavigation(win: BrowserWindow, policy: SenderPolicy): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url, policy)) {
      event.preventDefault()
    }
  })
}
