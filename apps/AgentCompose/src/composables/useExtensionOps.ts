/**
 * Pi 扩展的安装 / 删除编排。
 *
 * 状态只有一处存：通知（`useNotifications`）—— 跟 CLI 包操作一个路子。
 *
 * 装扩展可能要 clone 仓库、等几十秒，弹窗早就关了；
 * 顶栏铃铛里那条通知就是唯一的进度条。
 */
import { installExtensionFromNpm, removeExtensionFromLibrary } from '@/api/extensions'
import { useNotifications } from '@/composables/useNotifications'

/** 扩展的来源 */
export type ExtensionKind = 'npm' | 'custom'

let doneHandler: (() => void | Promise<void>) | null = null

/** 注册「操作完了要做什么」（扩展页用它重新扫描已安装） */
export const setExtensionDoneHandler = (handler: (() => void | Promise<void>) | null): void => {
  doneHandler = handler
}

export const useExtensionOps = () => {
  const { notices, start, finish, setAction } = useNotifications()

  /**
   * 从 npm 装一个扩展。
   *
   * 通知里能看到：正在装 → 装好了 / 失败（带「重试」）。
   */
  const install = async (name: string): Promise<boolean> => {
    const id = start(`正在安装扩展 ${name}`, `npm install ${name}`, name, {
      op: 'install',
      name,
      target: '',
      commandLine: `npm install ${name}`,
    })
    try {
      const result = await installExtensionFromNpm(name)
      if (!result.ok) throw new Error(result.message)
      finish(id, 'success', { title: `${name} 已安装`, detail: '' })
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      finish(id, 'error', {
        title: `${name} 安装失败`,
        detail,
        action: { label: '重试', run: () => void install(name) },
      })
      return false
    } finally {
      await doneHandler?.()
    }
  }

  /** 删掉工具箱里的一个扩展 */
  const remove = async (kind: ExtensionKind, name: string): Promise<boolean> => {
    const label = kind === 'npm' ? 'npm 扩展' : '自定义扩展'
    const id = start(`正在删除${label} ${name}`, name, name, {
      op: 'uninstall',
      name,
      target: '',
      commandLine: `删除 ${name}`,
    })
    try {
      const result = await removeExtensionFromLibrary(kind, name)
      if (!result.ok) throw new Error(result.message)
      finish(id, 'success', { title: `${name} 已删除`, detail: '' })
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      finish(id, 'error', {
        title: `${name} 删除失败`,
        detail,
        action: { label: '重试', run: () => void remove(kind, name) },
      })
      return false
    } finally {
      await doneHandler?.()
    }
  }

  /** 某个扩展最近的记录 */
  const opOf = (name: string) => notices.value.find((item) => item.key === name)

  /** 某个扩展是不是正在装 / 删 */
  const isBusy = (name: string): boolean => opOf(name)?.status === 'running'

  /** 按钮上的忙态文案 */
  const busyLabel = (name: string): string => {
    const notice = opOf(name)
    if (!notice || notice.status !== 'running') return ''
    return notice.op === 'uninstall' ? '删除中' : '安装中'
  }

  /**
   * 给从磁盘读回来的失败记录绑上「重试」。
   *
   * 动作是闭包，存不进文件 —— 启动时补上，用户不用回扩展页就能重试。
   */
  const bindRetryActions = (): void => {
    for (const notice of notices.value) {
      if (notice.status !== 'error' || notice.action) continue
      if (!notice.key) continue
      const name = notice.key
      const op = notice.op
      setAction(notice.id, {
        label: '重试',
        run: () => {
          if (op === 'uninstall') void remove('npm', name)
          else void install(name)
        },
      })
    }
  }

  return {
    install,
    remove,
    opOf,
    isBusy,
    busyLabel,
    bindRetryActions,
  }
}
