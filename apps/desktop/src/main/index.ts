import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, ipcMain } from 'electron'

import { IPC_CHANNELS, isAllowedChannel } from '../shared/channels'
import { guardNavigation, hardenSession } from './security'
import { isTrustedSender, type SenderPolicy } from './sender'

// electron-vite dev 时注入 dev server 地址;生产环境与 `electron .` 直接启动都没有该变量。
// 「是否开发态」以 dev server 是否在场为准,不再用 app.isPackaged 兼表两种语义。
const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, '../preload/index.cjs')
const rendererIndex = path.resolve(currentDir, '../renderer/index.html')

// 信任策略:开发态只信 dev server 的 origin;非开发态只信实际渲染层入口文件。
const senderPolicy: SenderPolicy = devServerUrl
  ? { kind: 'dev-server', origin: devServerUrl }
  : { kind: 'local-file', filePath: rendererIndex }

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      // 仅开发态(有 dev server)开 DevTools;打包产物与 `electron .` 直接启动都不开
      devTools: devServerUrl !== undefined,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  guardNavigation(mainWindow, senderPolicy)

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(rendererIndex)
  }
}

function registerIpcHandlers(): void {
  // 本轮唯一通道:只读探针,用于验证 contextBridge 通路
  // 启动期自检:登记前先过白名单闸门,新增频道漏改白名单时直接启动失败
  if (!isAllowedChannel(IPC_CHANNELS.appVersion)) {
    throw new Error(`[desktop] 拒绝登记非白名单 IPC 频道: ${IPC_CHANNELS.appVersion}`)
  }
  ipcMain.handle(IPC_CHANNELS.appVersion, (event) => {
    const senderUrl = event.senderFrame?.url
    if (!isTrustedSender(senderUrl, senderPolicy)) {
      throw new Error('untrusted sender')
    }
    return app.getVersion()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

void app.whenReady().then(() => {
  hardenSession()
  registerIpcHandlers()
  createWindow()
})
