import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNotifications } from '../composables/useNotifications'

/**
 * 通知 store 的持久化行为。
 * 记录要落盘（重启后还在），所以每一步都得跟后端对得上。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const { init, start, finish, dismiss, clear, notices, latestByKey } = useNotifications()

afterEach(() => {
  invokeMock.mockReset()
  clear()
})

describe('升级历史持久化', () => {
  it('开一条通知就落盘一次', async () => {
    invokeMock.mockResolvedValue(null)
    const id = start('正在升级 Claude Code', 'npm install -g xxx@latest', 'claude', {
      name: 'Claude Code',
      target: '2.1.318',
      commandLine: 'npm install -g xxx@latest',
    })

    const call = invokeMock.mock.calls.find((item) => item[0] === 'cli_op_history_upsert')
    expect(call).toBeTruthy()
    expect(call?.[1]).toEqual({
      record: {
        id,
        key: 'claude',
        op: 'upgrade',
        title: '正在升级 Claude Code',
        detail: 'npm install -g xxx@latest',
        status: 'running',
        name: 'Claude Code',
        target: '2.1.318',
        commandLine: 'npm install -g xxx@latest',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    })
  })

  it('状态变了要再落盘一次（动作不落盘 —— 它是个闭包）', () => {
    invokeMock.mockResolvedValue(null)
    const id = start('正在升级 Claude Code', 'npm install -g xxx@latest', 'claude')

    invokeMock.mockClear()
    finish(id, 'success', { title: 'Claude Code 已升级到 2.1.318' })

    const call = invokeMock.mock.calls.find((item) => item[0] === 'cli_op_history_upsert')
    const record = call?.[1]?.record
    expect(record?.status).toBe('success')
    expect(record?.title).toBe('Claude Code 已升级到 2.1.318')
    expect(record).not.toHaveProperty('action')
  })

  it('启动时把磁盘上的历史读回来', async () => {
    invokeMock.mockResolvedValue([
      {
        id: 'notice-1',
        key: 'claude',
        op: 'upgrade',
        title: 'Claude Code 已升级到 2.1.318',
        detail: 'npm install -g xxx@latest',
        status: 'success',
        name: 'Claude Code',
        target: '2.1.318',
        commandLine: 'npm install -g xxx@latest',
        createdAt: 1757000000000,
        updatedAt: 1757000000000,
      },
    ])

    await init()

    expect(notices.value).toHaveLength(1)
    expect(notices.value[0]!.title).toContain('已升级')
    expect(latestByKey('claude')?.status).toBe('success')
  })

  it('关掉一条 / 清空，都要落到磁盘上', () => {
    invokeMock.mockResolvedValue(null)
    const id = start('正在升级 Claude Code', 'npm install -g xxx@latest', 'claude')

    invokeMock.mockClear()
    dismiss(id)
    expect(invokeMock.mock.calls.some((item) => item[0] === 'cli_op_history_remove')).toBe(true)
    expect(notices.value).toHaveLength(0)

    invokeMock.mockClear()
    clear()
    expect(invokeMock.mock.calls.some((item) => item[0] === 'cli_op_history_clear')).toBe(true)
  })

  it('存历史失败不该影响界面', async () => {
    invokeMock.mockRejectedValue(new Error('磁盘满了'))
    const id = start('正在升级 Claude Code', 'npm install -g xxx@latest', 'claude')

    // 状态还在内存里，界面照常显示
    expect(notices.value).toHaveLength(1)
    finish(id, 'error', { detail: 'boom' })
    expect(notices.value[0]!.status).toBe('error')

    // 读历史失败也不该抛
    invokeMock.mockRejectedValue(new Error('文件坏了'))
    await expect(init()).resolves.toBeUndefined()
  })
})
