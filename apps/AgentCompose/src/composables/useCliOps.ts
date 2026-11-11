/**
 * CLI 包操作编排：安装 / 升级 / 卸载。
 *
 * 状态只有一处存：通知（useNotifications）。这里是「怎么把一次操作跑完」。
 *
 * 放在模块级而不是组件里：**重试按钮在顶栏的通知面板里** ——
 * 即使用户没打开 Agents 页，那条通知也得能重试。
 */
import { installAgent, uninstallAgent, upgradeAgent } from '@/api/agents'
import { useNotifications, type NoticeOp } from '@/composables/useNotifications'

/** 一次操作要记的东西 */
export interface CliOpTarget {
  /** agent 命令 */
  command: string
  /** agent 名 */
  name: string
  /** 目标版本（安装时为空） */
  target: string
  /** 将要执行的命令 */
  commandLine: string
  /** 做什么 */
  op: NoticeOp
  /** 装/升的版本（默认 latest） */
  version?: string
}

/** 操作的中文名 */
export const OP_LABEL: Record<NoticeOp, string> = {
  install: '安装',
  upgrade: '升级',
  uninstall: '卸载',
}

/** 升级结束后的回调（页面用它重新扫描本机安装） */
type DoneHandler = () => void | Promise<void>

let doneHandler: DoneHandler | null = null

/** 注册「操作完了要做什么」（Agents 页用它重新扫描） */
export const setUpgradeDoneHandler = (handler: DoneHandler | null): void => {
  doneHandler = handler
}

export const useCliOps = () => {
  const { notices, start, finish, setAction, latestByKey } = useNotifications()

  /** 按操作类型跑对应的命令 */
  const runOp = async (op: NoticeOp, command: string, version?: string): Promise<string> => {
    if (op === 'install') return installAgent(command, version)
    if (op === 'uninstall') return uninstallAgent(command)
    return upgradeAgent(command)
  }

  /**
   * 跑一次包操作。
   *
   * 进度只体现在通知里：弹窗早就关了，用户可能在别的页面上，
   * 顶栏铃铛里那条通知就是唯一的进度条。
   */
  const performOp = async (target: CliOpTarget): Promise<void> => {
    const { command, name, target: version, commandLine, op } = target
    const label = OP_LABEL[op]
    const runningTitle =
      op === 'upgrade' && version ? `正在升级 ${name} 到 ${version}` : `正在${label} ${name}`
    const id = start(runningTitle, commandLine, command, {
      op,
      name,
      target: version,
      commandLine,
    })

    try {
      await runOp(op, command, target.version)
      const doneTitle =
        op === 'upgrade' && version ? `${name} 已升级到 ${version}` : `${name} 已${label}`
      finish(id, 'success', { title: doneTitle, detail: commandLine })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      finish(id, 'error', {
        title: `${name} ${label}失败`,
        detail,
        action: { label: '重试', run: () => void performOp(target) },
      })
    } finally {
      // 操作完重新探一遍：装完版本变了、卸完就没了。
      await doneHandler?.()
    }
  }

  /**
   * 给所有失败记录绑上「重试」。
   *
   * 从磁盘读回来的记录没有动作（闭包存不下来）—— 启动时补上，
   * 用户不用回 Agents 页就能在通知面板里重试。
   */
  const bindRetryActions = (): void => {
    for (const notice of notices.value) {
      if (notice.status !== 'error' || notice.action) continue
      if (!notice.key || !notice.commandLine) continue
      setAction(notice.id, {
        label: '重试',
        run: () =>
          void performOp({
            command: notice.key!,
            name: notice.name ?? notice.key!,
            target: notice.target ?? '',
            commandLine: notice.commandLine!,
            op: (notice.op ?? 'upgrade') as NoticeOp,
          }),
      })
    }
  }

  /** 某个 agent 最近的记录 */
  const opOf = (command: string) => latestByKey(command)

  /** 某个 agent 是不是有操作在跑 */
  const isBusy = (command: string): boolean => opOf(command)?.status === 'running'

  /** 有没有操作正在跑（有就别去查更新了） */
  const hasRunningOp = (): boolean => notices.value.some((notice) => notice.status === 'running')

  /** 按钮上的忙态文案：安装中 / 升级中 / 卸载中 */
  const busyLabel = (command: string): string => {
    const notice = opOf(command)
    if (!notice || notice.status !== 'running') return ''
    return `${OP_LABEL[notice.op ?? 'upgrade']}中`
  }

  /**
   * 列表里的结果文案。
   *
   * 进行中不在这儿说 —— 版本列有专门的「安装中 / 卸载中」样式，
   * 不用两处都显示。
   *
   * 卸载成功不在列表里说：那一行已经回到初始样子（变成「安装」按钮了），
   * 再写一句「已卸载」是多余的。
   */
  const statusText = (command: string): string => {
    const notice = opOf(command)
    if (!notice || notice.status === 'running') return ''
    const label = OP_LABEL[notice.op ?? 'upgrade']
    if (notice.status === 'success') {
      return notice.op === 'uninstall' ? '' : `已${label}`
    }
    return `${label}失败`
  }

  /** 失败原因（列表里要看见，不能只藏在一个 tooltip 里） */
  const failureReason = (command: string): string => {
    const notice = opOf(command)
    if (notice?.status !== 'error') return ''
    return notice.detail
  }

  return {
    performOp,
    bindRetryActions,
    opOf,
    isBusy,
    hasRunningOp,
    busyLabel,
    statusText,
    failureReason,
  }
}
