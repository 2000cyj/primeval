/**
 * 全局通知（右上角铃铛里的那些记录）。
 *
 * 落盘在 `~/.agent-compose/upgrades.json`（Rust 侧写），**重启后还在** ——
 * 升级这种事用户不会盯着窗口看，下次打开应用还看得见上次升成什么样。
 *
 * 只有一个进程写它（GUI），数据量有界，所以用 JSON 文件而不是数据库。
 */
import { computed, readonly, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/** 通知状态：进行中 / 成功 / 失败 */
export type NoticeStatus = 'running' | 'success' | 'error'

/** 通知记录的操作：安装 / 升级 / 卸载 */
export type NoticeOp = 'install' | 'upgrade' | 'uninstall'

/** 通知上可点的动作（如「重试」） */
export interface NoticeAction {
  /** 按钮文案 */
  label: string
  /** 点一下要干的活 */
  run: () => void
}

/** 一条通知 */
export interface Notice {
  /** 唯一 id */
  id: string
  /** 业务键（如 agent 的命令）：列表靠它把状态对上行 */
  key?: string
  /** 做了什么：安装 / 升级 / 卸载 */
  op?: NoticeOp
  /** 标题，如「正在升级 Claude Code」 */
  title: string
  /** 补充说明：执行的命令 / 失败原因 */
  detail: string
  /** 状态 */
  status: NoticeStatus
  /** 可选动作（如失败后重试）—— 不落盘，重启后由调用方重新绑上 */
  action?: NoticeAction
  /** agent 名（重试时用） */
  name?: string
  /** 目标版本（重试时用） */
  target?: string
  /** 升级命令（重试时用） */
  commandLine?: string
  /** 创建时间（epoch 毫秒） */
  createdAt: number
  /** 最后更新时间（epoch 毫秒） */
  updatedAt: number
}

/** Rust 侧的 command 名 */
export const CLI_OP_COMMANDS = {
  load: 'cli_op_history_load',
  upsert: 'cli_op_history_upsert',
  remove: 'cli_op_history_remove',
  clear: 'cli_op_history_clear',
} as const

/** 落盘用的形状（动作存不进去，也不该存） */
type RecordPayload = {
  id: string
  key: string
  op: string
  title: string
  detail: string
  status: string
  name: string
  target: string
  commandLine: string
  createdAt: number
  updatedAt: number
}

/** 全部通知，最新的在最前 */
const notices = ref<Notice[]>([])

/** 自增序号：同毫秒内发多条也不会撞 id */
let seq = 0

const nextId = (): string => `notice-${Date.now()}-${(seq += 1)}`

/** 把内存里的通知转成落盘形状 */
const toPayload = (notice: Notice): RecordPayload => ({
  id: notice.id,
  key: notice.key ?? '',
  op: notice.op ?? 'upgrade',
  title: notice.title,
  detail: notice.detail,
  status: notice.status,
  name: notice.name ?? '',
  target: notice.target ?? '',
  commandLine: notice.commandLine ?? '',
  createdAt: notice.createdAt,
  updatedAt: notice.updatedAt,
})

/**
 * 落盘：失败也不能影响界面。
 *
 * 存历史是锦上添花（界面上的状态内存里已经有了），
 * 存不进去就当没有下次 —— 不能因此报错。
 */
const persist = (run: () => Promise<unknown>): void => {
  try {
    void Promise.resolve(run()).catch((error) => console.error('保存升级历史失败', error))
  } catch (error) {
    console.error('保存升级历史失败', error)
  }
}

/**
 * 通知的读写接口。
 *
 * 典型用法（发起一个带进度的任务）：
 * ```ts
 * const id = start('正在升级 Claude Code', 'npm install -g xxx@latest')
 * try {
 *   await doSomething()
 *   finish(id, 'success', { title: 'Claude Code 已升级' })
 * } catch (error) {
 *   finish(id, 'error', { detail: String(error) })
 * }
 * ```
 */
export const useNotifications = () => {
  /** 从磁盘把历史读进来。应用启动时调一次。 */
  const init = async (): Promise<void> => {
    try {
      const loaded = await invoke<RecordPayload[]>(CLI_OP_COMMANDS.load)
      const existing = notices.value
      const known = new Set(existing.map((item) => item.id))
      const restored = loaded
        .filter((item) => !known.has(item.id))
        .map((item) => ({
          ...item,
          op: (item.op || 'upgrade') as NoticeOp,
          status: item.status as NoticeStatus,
        }))
      notices.value = [...existing, ...restored].sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      // 读不到历史不该挡住界面：顶栏显示空列表而已
      console.error('读取升级历史失败', error)
    }
  }

  /** 新开一条「进行中」的通知，返回它的 id */
  const start = (
    title: string,
    detail = '',
    key?: string,
    extra?: { op?: NoticeOp; name?: string; target?: string; commandLine?: string },
  ): string => {
    const id = nextId()
    const now = Date.now()
    const notice: Notice = {
      id,
      key,
      op: extra?.op ?? 'upgrade',
      title,
      detail,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      ...extra,
    }
    notices.value = [notice, ...notices.value]
    persist(() => invoke(CLI_OP_COMMANDS.upsert, { record: toPayload(notice) }))
    return id
  }

  /** 把一条通知改成终态 */
  const finish = (
    id: string,
    status: 'success' | 'error',
    patch?: { title?: string; detail?: string; action?: NoticeAction },
  ): void => {
    const current = notices.value.find((item) => item.id === id)
    if (!current) return
    const updated: Notice = {
      ...current,
      status,
      title: patch?.title ?? current.title,
      detail: patch?.detail ?? current.detail,
      action: patch?.action,
      updatedAt: Date.now(),
    }
    notices.value = notices.value.map((item) => (item.id === id ? updated : item))
    persist(() => invoke(CLI_OP_COMMANDS.upsert, { record: toPayload(updated) }))
  }

  /**
   * 给一条通知绑一个动作。
   *
   * 动作是闭包，存不进磁盘 —— 所以只改内存，不落盘；
   * 重启后由调用方按记录里的命令重新绑。
   */
  const setAction = (id: string, action: NoticeAction): void => {
    notices.value = notices.value.map((item) => (item.id === id ? { ...item, action } : item))
  }

  /** 关掉一条通知（也从磁盘删掉） */
  const dismiss = (id: string): void => {
    notices.value = notices.value.filter((item) => item.id !== id)
    persist(() => invoke(CLI_OP_COMMANDS.remove, { id }))
  }

  /** 清空全部 */
  const clear = (): void => {
    notices.value = []
    persist(() => invoke(CLI_OP_COMMANDS.clear))
  }

  /** 某个业务键对应的最新一条通知（列表用它显示状态） */
  const latestByKey = (key: string): Notice | undefined =>
    notices.value.find((item) => item.key === key)

  /** 还在跑的条数（顶栏角标用） */
  const runningCount = computed(
    () => notices.value.filter((item) => item.status === 'running').length,
  )

  return {
    notices: readonly(notices),
    runningCount,
    init,
    start,
    finish,
    setAction,
    latestByKey,
    dismiss,
    clear,
  }
}
