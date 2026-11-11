import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentsView from '../views/AgentsView.vue'
import { useNotifications } from '../composables/useNotifications'
import clawIcon from '@/assets/agent-icons/claw.svg'
import piIcon from '@/assets/agent-icons/pi.svg'
import ompIcon from '@/assets/agent-icons/omp.svg'
import minimaxIcon from '@/assets/agent-icons/minimax.svg'

/**
 * 页面数据来自 tauri command（本机真实探测结果），不再有 mock 兜底。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const detected = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    installed: true,
    version: '2.1.311',
    path: 'D:\nodejs\claude.cmd',
    error: null,
    installs: [
      {
        path: 'D:\nodejs\claude.cmd',
        version: '2.1.311',
        runnable: true,
        error: null,
        source: 'npm',
        isPathDefault: true,
      },
      {
        path: 'C:\Users\test\.local\bin\claude',
        version: '2.1.300',
        runnable: true,
        error: null,
        source: 'unknown',
        isPathDefault: false,
      },
    ],
    package: '@anthropic-ai/claude-code',
    source: 'npm',
    latestVersion: '2.1.318',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    installed: false,
    version: null,
    path: null,
    error: null,
    installs: [],
    package: '@google/gemini-cli',
    source: '',
    latestVersion: null,
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    command: 'codex',
    installed: true,
    version: null,
    path: 'D:\nodejs\codex.cmd',
    error: '`--version` 以 1 退出且没有输出',
    installs: [
      {
        path: 'D:\nodejs\codex.cmd',
        version: null,
        runnable: false,
        error: '`--version` 以 1 退出且没有输出',
        source: 'npm',
        isPathDefault: true,
      },
    ],
    package: '@openai/codex',
    source: 'npm',
    latestVersion: null,
  },
]

const { notices, clear: clearNotices } = useNotifications()

/** naive-ui 的悬浮提示有延迟，要等一下才出内容 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 悬停到某个元素上，等提示内容出来 */
const hover = async (wrapper: VueWrapper, selector: string): Promise<void> => {
  const target = wrapper.find(selector)
  await target.trigger('mouseover')
  await target.trigger('mouseenter')
  await sleep(300)
  await flushPromises()
}

/** 当前挂着的视图：每个用例结束后要卸掉 */
let wrapper: VueWrapper | null = null

const mountView = async () => {
  wrapper = mount({
    components: { NMessageProvider, AgentsView },
    template: '<NMessageProvider><AgentsView /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  // 视图不卸掉的话，它的弹窗会在下一个用例里跟着冒出来
  wrapper?.unmount()
  wrapper = null
  invokeMock.mockReset()
  clearNotices()
  document.body.innerHTML = ''
})

describe('AgentsView', () => {
  it('渲染探测到的本机 CLI', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan' ? Promise.resolve(detected) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    const text = wrapper.text()
    expect(text).toContain('Claude Code')
    expect(text).toContain('2.1.311')
    expect(text).toContain('D:\nodejs\claude.cmd')
    // 装的数量 / 总数
    expect(wrapper.get('.table-count').text()).toBe('2 / 3')
  })

  it('未安装的显示为未安装，不伪造版本', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan' ? Promise.resolve(detected) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('未检测到')
    expect(wrapper.text()).toContain('未安装')
  })

  it('装了但跑不起来时给个感叹号，错误内容鼠标移上去才看', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan' ? Promise.resolve(detected) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('无法运行')
    // 错误不铺在列表里，只有一个感叹号
    expect(wrapper.text()).not.toContain('--version')
    expect(wrapper.find('.cell-warn').exists()).toBe(true)

    // 悬停才看得到真实原因
    await hover(wrapper, '.cell-warn')
    expect(document.body.textContent ?? '').toContain('--version')
  })

  it('多处安装时行内给出「另有 N 处安装」入口，点开展开明细', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_installations') {
        return Promise.resolve(detected[0]!.installs)
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    // 行内入口（不是弹窗）
    const installsButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('另有 1 处安装'))
    expect(installsButton).toBeDefined()
    expect(wrapper.text()).not.toContain('检测到 2 处安装')

    await installsButton!.trigger('click')
    await flushPromises()

    // 展开时按需拉一次安装明细（带各处的版本）
    expect(invokeMock.mock.calls.some((item) => item[0] === 'agents_installations')).toBe(true)

    // 展开面板：cc-switch 的 ToolInstallRow 排版
    const text = wrapper.text()
    expect(text).toContain('检测到 2 处安装')
    expect(text).toContain('默认')
    expect(text).toContain('2.1.300')
    expect(text).toContain('C:\Users\test\.local\bin\claude')
  })

  it('有新版时出现升级按钮，点击后先确认再执行', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_package_versions') return Promise.resolve(['2.1.320', '2.1.319'])
      if (command === 'agents_package_plan') {
        return Promise.resolve({
          version: 'latest',
          command: 'claude',
          name: 'Claude Code',
          package: '@anthropic-ai/claude-code',
          manager: 'npm',
          commandLine: 'npm install -g @anthropic-ai/claude-code@latest',
          path: 'D:\nodejs\claude.cmd',
        })
      }
      if (command === 'agents_upgrade') return Promise.resolve('npm install -g ...')
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('有新版本')
    expect(wrapper.text()).toContain('2.1.318')

    const upgradeButton = wrapper.findAll('button').find((button) => button.text() === '升级')
    await upgradeButton!.trigger('click')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 确认弹窗里摆出将要执行的命令 + 各处安装（抄 cc-switch）
    const body = document.body.textContent ?? ''
    expect(body).toContain('确认升级位置')
    expect(body).toContain('将执行：')
    expect(body).toContain('npm install -g @anthropic-ai/claude-code@latest')
    expect(body).toContain('默认')

    const confirmButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认升级'),
    ) as HTMLButtonElement
    confirmButton.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'agents_upgrade')
    expect(call?.[1]).toEqual({ command: 'claude' })
  })

  it('版本查询只针对本地装上的工具', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_check_updates') {
        return Promise.resolve([
          { command: 'claude', latestVersion: '2.1.319' },
          { command: 'codex', latestVersion: '0.167.0' },
        ])
      }
      return Promise.resolve(null)
    })
    await mountView()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'agents_check_updates')
    // gemini 没装，不该去问 registry
    expect(call?.[1]).toEqual({ commands: ['claude', 'codex'] })
  })

  it('探测失败时展示真实原因，不展示假数据', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan'
        ? Promise.reject(new Error('探测本机 CLI agents 失败：sidecar 未运行'))
        : Promise.resolve(null),
    )
    const wrapper = await mountView()

    expect(wrapper.get('.scan-error').text()).toContain('sidecar 未运行')
    expect(wrapper.text()).not.toContain('Claude Code')
  })

  it('取不到方案时要把原因显示出来，不能点了没反应', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_package_plan') {
        return Promise.reject(
          new Error('Claude Code 是通过 scoop 安装的，不支持自动升级，请手动升级'),
        )
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const upgradeButton = wrapper.findAll('button').find((button) => button.text() === '升级')
    await upgradeButton!.trigger('click')
    await flushPromises()

    // 原因直接告知用户（顶栏提示），不能静悄悄地什么也不发生
    const body = document.body.textContent ?? ''
    expect(body).toContain('不支持自动升级')
    // 没有方案 → 不会进到确认那一步
    expect(body).not.toContain('将执行：')
  })

  it('图标用的是 cc-switch 那套（OpenClaw / Pi / Oh My Pi / MiniMax Code 都是）', async () => {
    const withTools = [
      detected[0]!,
      {
        ...detected[0]!,
        id: 'openclaw',
        name: 'OpenClaw',
        command: 'openclaw',
        package: 'openclaw',
        latestVersion: null,
        installs: [],
      },
      {
        ...detected[0]!,
        id: 'pi',
        name: 'Pi',
        command: 'pi',
        package: 'pi',
        latestVersion: null,
        installs: [],
      },
      {
        ...detected[0]!,
        id: 'omp',
        name: 'Oh My Pi',
        command: 'omp',
        package: 'omp',
        latestVersion: null,
        installs: [],
      },
      {
        ...detected[0]!,
        id: 'mcode',
        name: 'MiniMax Code',
        command: 'mcode',
        package: 'mcode',
        latestVersion: null,
        installs: [],
      },
    ]
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan' ? Promise.resolve(withTools) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    const srcOf = (name: string): string => {
      const img = wrapper.findAll('img').find((item) => item.attributes('alt') === name)
      return img?.attributes('src') ?? ''
    }

    expect(srcOf('Claude Code')).toContain('svg')
    // cc-switch 自己给 OpenClaw 配的是 claw.svg（之前错用了 Anthropic 的）
    expect(srcOf('OpenClaw')).toBe(clawIcon)
    // Pi / Oh My Pi 在 cc-switch 里是内联 SVG，也提取过来了（之前都错用了 GitHub 图标）
    expect(srcOf('Pi')).toBe(piIcon)
    expect(srcOf('Oh My Pi')).toBe(ompIcon)
    // MiniMax Code 用 cc-switch 的 minimax 图标
    expect(srcOf('MiniMax Code')).toBe(minimaxIcon)
  })

  it('没装的 agent：版本列只给安装按钮，不写「未安装」，也没有三个点', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan' ? Promise.resolve(detected) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    // 版本列不再摆「未安装」两个字（状态列的标签不算）
    const versionCells = wrapper.findAll('.cell-version')
    expect(versionCells.some((cell) => cell.text().includes('未安装'))).toBe(false)
    // 有安装按钮
    const installButton = wrapper.findAll('button').find((button) => button.text() === '安装')
    expect(installButton).toBeTruthy()

    // 没装的 agent 三个点菜单都不给
    const menuButtons = wrapper
      .findAll('button')
      .filter((button) => (button.attributes('aria-label') ?? '').includes('更多操作'))
    expect(menuButtons).toHaveLength(2)
    expect(
      wrapper
        .findAll('button')
        .some((button) => (button.attributes('aria-label') ?? '').includes('Gemini CLI 更多操作')),
    ).toBe(false)
  })

  it('点安装：确认后调 agents_install，通知里是「安装中」', async () => {
    let finishInstall: (value: string) => void = () => {}
    const installing = new Promise<string>((resolve) => {
      finishInstall = resolve
    })

    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_check_updates') return Promise.resolve([])
      if (command === 'agents_package_versions') {
        return Promise.resolve(['2.1.320', '2.1.319'])
      }
      if (command === 'agents_package_plan') {
        return Promise.resolve({
          version: 'latest',
          command: 'gemini',
          name: 'Gemini CLI',
          package: '@google/gemini-cli',
          manager: 'npm',
          commandLine: 'npm install -g @google/gemini-cli@latest',
          path: '',
          program: 'D:\\nodejs\\npm.cmd',
          args: ['install', '-g', '@google/gemini-cli@latest'],
        })
      }
      if (command === 'agents_install') return installing
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const installButton = wrapper.findAll('button').find((button) => button.text() === '安装')
    await installButton!.trigger('click')
    await flushPromises()

    // 确认弹窗里摆出将要执行的命令（弹窗自己拉方案，等它一下）
    await new Promise((resolve) => setTimeout(resolve, 50))
    const body = document.body.textContent ?? ''
    expect(body).toContain('确认安装')
    expect(body).toContain('npm install -g @google/gemini-cli@latest')

    const confirmButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认安装'),
    ) as HTMLButtonElement
    confirmButton.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'agents_install')
    expect(call?.[1]).toEqual({ command: 'gemini', version: 'latest' })

    // 通知里记着这次安装
    expect(notices.value).toHaveLength(1)
    expect(notices.value[0]!.status).toBe('running')
    expect(notices.value[0]!.op).toBe('install')

    // 版本列直接展示「安装中」
    expect(wrapper.find('.cell-op-busy').text()).toContain('安装中')

    // 装完 → 成功
    finishInstall('npm install -g ...')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(notices.value[0]!.status).toBe('success')
    // 忙态消失，结果显示在状态行
    expect(wrapper.find('.cell-op-busy').exists()).toBe(false)
    expect(wrapper.text()).toContain('已安装')
  })

  it('已装的 agent：三个点里只有卸载，卸载是破坏性的（标红）', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'agents_scan' ? Promise.resolve(detected) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    const menuButton = wrapper
      .findAll('button')
      .find((button) => (button.attributes('aria-label') ?? '').includes('Claude Code 更多操作'))
    expect(menuButton).toBeTruthy()
    await menuButton!.trigger('click')
    await flushPromises()

    // 菜单里只有卸载，而且是破坏性的（标红）
    const items = [...document.body.querySelectorAll('.menu-item')]
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toContain('卸载')
    expect(items[0]!.className).toContain('menu-item-danger')
  })

  it('点卸载：确认后调 agents_uninstall', async () => {
    let finishUninstall: (value: string) => void = () => {}
    const uninstalling = new Promise<string>((resolve) => {
      finishUninstall = resolve
    })

    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_check_updates') return Promise.resolve([])
      if (command === 'agents_package_plan') {
        return Promise.resolve({
          command: 'claude',
          name: 'Claude Code',
          package: '@anthropic-ai/claude-code',
          manager: 'npm',
          commandLine: 'npm uninstall -g @anthropic-ai/claude-code',
          path: 'D:\\nodejs\\claude.cmd',
          program: 'D:\\nodejs\\npm.cmd',
          args: ['uninstall', '-g', '@anthropic-ai/claude-code'],
        })
      }
      if (command === 'agents_uninstall') return uninstalling
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const menuButton = wrapper
      .findAll('button')
      .find((button) => (button.attributes('aria-label') ?? '').includes('Claude Code 更多操作'))
    await menuButton!.trigger('click')
    await flushPromises()

    const option = [...document.body.querySelectorAll('.menu-item')][0] as HTMLElement
    option.click()
    await flushPromises()

    const body = document.body.textContent ?? ''
    expect(body).toContain('确认卸载')
    expect(body).toContain('npm uninstall -g @anthropic-ai/claude-code')

    const confirmButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认卸载'),
    ) as HTMLButtonElement
    confirmButton.click()
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'agents_uninstall')
    expect(call?.[1]).toEqual({ command: 'claude' })
    expect(notices.value[0]!.op).toBe('uninstall')
    // 版本列展示「卸载中」
    expect(wrapper.find('.cell-op-busy').text()).toContain('卸载中')

    // 卸完 → 成功，忙态消失
    finishUninstall('npm uninstall -g ...')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(notices.value[0]!.status).toBe('success')
    expect(wrapper.find('.cell-op-busy').exists()).toBe(false)
    // 卸载成功不写「已卸载」：那一行回到初始样子（安装按钮）
    expect(wrapper.text()).not.toContain('已卸载')
    expect(wrapper.findAll('button').some((button) => button.text() === '安装')).toBe(true)
  })

  it('升级在后台跑：弹窗立即关闭，进度在通知里，列表只展示状态', async () => {
    let finishUpgrade: (value: string) => void = () => {}
    const upgrading = new Promise<string>((resolve) => {
      finishUpgrade = resolve
    })

    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_check_updates') return Promise.resolve([])
      if (command === 'agents_package_plan') {
        return Promise.resolve({
          command: 'claude',
          name: 'Claude Code',
          package: '@anthropic-ai/claude-code',
          manager: 'npm',
          commandLine: 'npm install -g @anthropic-ai/claude-code@latest',
          path: 'D:\nodejs\claude.cmd',
          program: 'D:\nodejs\npm.cmd',
          args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
        })
      }
      if (command === 'agents_upgrade') return upgrading
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const upgradeButton = wrapper.findAll('button').find((button) => button.text() === '升级')
    await upgradeButton!.trigger('click')
    await flushPromises()

    const confirmButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认升级'),
    ) as HTMLButtonElement
    confirmButton.click()
    await flushPromises()

    // 弹窗立即关了 —— 升级转后台，不让人对着弹窗干等
    const modal = document.querySelector('.n-modal') as HTMLElement | null
    expect(modal?.style.display).toBe('none')

    // 通知里多了一条「进行中」的升级记录
    expect(notices.value).toHaveLength(1)
    expect(notices.value[0]!.title).toContain('Claude Code')
    expect(notices.value[0]!.status).toBe('running')
    expect(notices.value[0]!.detail).toContain('npm install -g')

    // 版本列直接展示「升级中」，状态行不重复说
    expect(wrapper.find('.cell-op-busy').exists()).toBe(true)
    expect(wrapper.find('.cell-op-busy').text()).toContain('升级中')
    expect(wrapper.text()).not.toContain('升级中…')

    // 升级期间不再查更新
    const checkCalls = invokeMock.mock.calls.filter((item) => item[0] === 'agents_check_updates')
    expect(checkCalls).toHaveLength(1)

    // 升完 → 通知变成成功，列表状态跟着变
    finishUpgrade('npm install -g ...')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(notices.value[0]!.status).toBe('success')
    expect(notices.value[0]!.title).toContain('已升级')
    expect(wrapper.text()).toContain('已升级')
    expect(wrapper.text()).not.toContain('升级中')
  })

  it('升级失败时通知与列表都显示失败，通知带「重试」', async () => {
    let attempts = 0
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agents_scan') return Promise.resolve(detected)
      if (command === 'agents_check_updates') return Promise.resolve([])
      if (command === 'agents_package_plan') {
        return Promise.resolve({
          command: 'claude',
          name: 'Claude Code',
          package: '@anthropic-ai/claude-code',
          manager: 'npm',
          commandLine: 'npm install -g @anthropic-ai/claude-code@latest',
          path: 'D:\nodejs\claude.cmd',
          program: 'D:\nodejs\npm.cmd',
          args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
        })
      }
      if (command === 'agents_upgrade') {
        attempts += 1
        return Promise.reject(new Error('升级失败：EACCES permission denied'))
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    const upgradeButton = wrapper.findAll('button').find((button) => button.text() === '升级')
    await upgradeButton!.trigger('click')
    await flushPromises()

    const confirmButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('确认升级'),
    ) as HTMLButtonElement
    confirmButton.click()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(notices.value[0]!.status).toBe('error')
    expect(notices.value[0]!.title).toContain('升级失败')
    expect(notices.value[0]!.detail).toContain('EACCES')

    // 列表里只给状态 + 感叹号，失败原因在悬浮提示里
    expect(wrapper.text()).toContain('升级失败')
    expect(wrapper.text()).not.toContain('EACCES permission denied')
    expect(wrapper.find('.cell-warn').exists()).toBe(true)

    await hover(wrapper, '.cell-warn')
    expect(document.body.textContent ?? '').toContain('EACCES permission denied')

    // 失败通知带一个「重试」动作
    const action = notices.value[0]!.action
    expect(action?.label).toBe('重试')

    // 点重试 → 再升一次
    action?.run()
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(attempts).toBe(2)
  })
})
