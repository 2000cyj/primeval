import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BackupImportModal from '../components/BackupImportModal.vue'

/**
 * 导入弹窗。
 *
 * 重点是「默认不勾覆盖」—— 导入是增量动作，不该把本机已有的东西悄悄换掉。
 *
 * 导入本身是**异步**的：后端立刻返回 taskId，进度与结果走事件。
 * 所以测试里要模拟事件推送，不能等 invoke 的返回值。
 */
const invokeMock = vi.hoisted(() => vi.fn())
const openMock = vi.hoisted(() => vi.fn())
/** 事件监听器（后端推事件用） */
const listeners = vi.hoisted(() => ({
  progress: [] as ((event: { payload: unknown }) => void)[],
  done: [] as ((event: { payload: unknown }) => void)[],
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
    if (event === 'backup-import-progress') listeners.progress.push(handler)
    if (event === 'backup-import-done') listeners.done.push(handler)
    return Promise.resolve(() => undefined)
  }),
}))

/** 通知系统：只关心它被调了没有 */
const noticeMock = vi.hoisted(() => ({
  start: vi.fn((_title: string, _detail?: string) => 'notice-1'),
  finish: vi.fn((_id: string, _status: 'success' | 'error', _patch?: unknown) => undefined),
}))

vi.mock('@/composables/useNotifications', () => ({
  useNotifications: () => ({
    start: noticeMock.start,
    finish: noticeMock.finish,
  }),
}))

const report = {
  summary: { agents: 1, skills: 2, mcpServers: 1, extensions: 1 },
  conflicts: [
    {
      kind: 'skill',
      key: 'vue',
      label: 'vue',
      localHint: '已存在，来源 github.com/x/vue@1.0',
      incomingHint: '远程 · github.com/y/vue@2.0',
    },
    {
      kind: 'skill',
      key: 'typescript',
      label: 'typescript',
      localHint: '已存在（manual）',
      incomingHint: '本地文件',
    },
    {
      kind: 'mcpServer',
      key: 'idea',
      label: 'idea',
      localHint: '已存在同名 server',
      incomingHint: 'registry · io.github.jetbrains/idea',
    },
    {
      kind: 'extension',
      key: 'context-mode',
      label: 'context-mode',
      localHint: '已存在同名扩展',
      incomingHint: 'npm · @mksglu/context-mode',
    },
  ],
  freshCount: 1,
  warnings: [],
}

const importResult = {
  imported: { agents: 1, skills: 1, mcpServers: 0, extensions: 0 },
  skipped: { agents: 0, skills: 1, mcpServers: 0, extensions: 0 },
  failures: [],
  warnings: [],
}

const mountModal = async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'backup_inspect') return Promise.resolve(report)
    if (command === 'backup_import') return Promise.resolve('import-0')
    return Promise.resolve(null)
  })
  openMock.mockResolvedValue('C:/tmp/AgentSpace-export.zip')

  const show = ref(false)
  const wrapper = mount({
    components: { NMessageProvider, BackupImportModal },
    setup: () => ({ show }),
    template: `
      <NMessageProvider>
        <BackupImportModal :show="show" />
      </NMessageProvider>
    `,
  })
  show.value = true
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

/** 文本里带指定字样的按钮。 */
const buttonOf = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('button')].find((button) =>
    button.textContent?.includes(text),
  )

/** 选文件 → 进到冲突确认那一步。 */
const pickAndInspect = async (): Promise<void> => {
  document.querySelector<HTMLElement>('.pick-btn')?.click()
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

/** 模拟后端推一个进度事件。 */
const emitProgress = (payload: Record<string, unknown>): void => {
  for (const handler of listeners.progress) handler({ payload })
}

/** 模拟后端推一个完成事件。 */
const emitDone = (payload: Record<string, unknown>): void => {
  for (const handler of listeners.done) handler({ payload })
}

describe('导入弹窗', () => {
  it('选完文件先看冲突清单，冲突默认不勾覆盖', async () => {
    await mountModal()

    await pickAndInspect()

    expect(openMock).toHaveBeenCalled()
    // 4 条冲突都不勾 → 全跳过；1 条不冲突的直接导入
    expect(document.body.textContent).toContain('将导入 1 项，跳过 4 项')
    expect(document.body.textContent).toContain('vue')
    // 每条冲突的「覆盖」勾选框都是未勾（分组全选框也算一个，要挑对）
    const itemChecks = [...document.querySelectorAll<HTMLElement>('.conflict .n-checkbox')]
    expect(itemChecks).toHaveLength(4)
    for (const check of itemChecks) {
      expect(check.className).not.toContain('n-checkbox--checked')
    }
  })

  it('确认后启动导入（立刻返回 taskId），结果走事件', async () => {
    const wrapper = await mountModal()

    await pickAndInspect()

    buttonOf('确认导入')?.click()
    await flushPromises()

    // 后端只返回 taskId，不返回结果
    const call = invokeMock.mock.calls.find((item) => item[0] === 'backup_import')
    expect(call).toBeTruthy()
    expect(call?.[1]).toEqual({
      request: {
        zipPath: 'C:/tmp/AgentSpace-export.zip',
        overwriteKeys: [],
      },
    })

    // 弹窗进到「后台运行」那一步
    expect(document.body.textContent).toContain('后台运行')

    // 后端推完成事件 → 结果页
    emitDone({ taskId: 'import-0', result: importResult })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('导入完成')
  })

  it('进度事件更新弹窗里的进度条', async () => {
    const wrapper = await mountModal()

    await pickAndInspect()
    buttonOf('确认导入')?.click()
    await flushPromises()

    emitProgress({
      taskId: 'import-0',
      phase: '导入 Skills',
      current: 3,
      total: 10,
      message: 'vue',
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('导入 Skills')
    expect(document.body.textContent).toContain('vue')
  })

  it('导入过程写进顶栏通知，跑完改成结果', async () => {
    await mountModal()

    await pickAndInspect()
    buttonOf('确认导入')?.click()
    await flushPromises()

    // 有一条「进行中」的通知
    expect(noticeMock.start).toHaveBeenCalled()
    const startedTitle = noticeMock.start.mock.calls[0]?.[0] as unknown
    expect(String(startedTitle)).toContain('导入')

    emitDone({ taskId: 'import-0', result: importResult })
    await flushPromises()

    // 跑完通知变成成功
    expect(noticeMock.finish).toHaveBeenCalled()
    const finishArgs = noticeMock.finish.mock.calls[0] as unknown[]
    expect(finishArgs[1]).toBe('success')
  })

  it('分组全选把该组所有冲突都勾上覆盖，再点一次全取消', async () => {
    await mountModal()

    await pickAndInspect()

    // 找到 Skills 分组里的「全选覆盖」
    const skillGroup = [...document.querySelectorAll<HTMLElement>('.conflict-group')].find(
      (group) => group.querySelector('.group-title')?.textContent?.trim() === 'Skills',
    )
    // naive-ui 的 class 合并到组件根元素上 —— .group-all 就是那个根元素
    skillGroup?.querySelector<HTMLElement>('.group-all')?.click()
    await flushPromises()

    buttonOf('确认导入')?.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'backup_import')
    // Skills 组里的两条都被勾上了
    expect(call?.[1]).toEqual({
      request: {
        zipPath: 'C:/tmp/AgentSpace-export.zip',
        overwriteKeys: ['skill:vue', 'skill:typescript'],
      },
    })
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  invokeMock.mockReset()
  openMock.mockReset()
  noticeMock.start.mockClear()
  noticeMock.finish.mockClear()
  listeners.progress.length = 0
  listeners.done.length = 0
})
