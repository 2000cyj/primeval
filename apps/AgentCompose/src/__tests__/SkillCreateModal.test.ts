import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SkillCreateModal from '../components/SkillCreateModal.vue'

/**
 * 弹窗内容被 teleport 到 body，所以用 document.body 查询元素。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const skillInfo = {
  name: '市场报告生成器',
  description: '生成市场报告',
  path: 'C:/Users/test/.agent-compose/skills/market-report',
  source: 'manual',
  updatedAtMs: 1762300000000,
  fileCount: 1,
}

const runtimeSkill = {
  name: 'pdf-tools',
  description: '处理 PDF',
  path: 'C:/Users/test/.claude/skills/pdf-tools',
  runtime: 'Claude Code',
  installed: false,
}

const mountModal = async (initialMethod?: 'manual' | 'local' | 'url' | 'runtime') => {
  const wrapper = mount(SkillCreateModal, {
    props: { show: true, initialMethod: initialMethod ?? null },
  })
  await flushPromises()
  return wrapper
}

const click = async (selector: string, index = 0) => {
  const elements = document.body.querySelectorAll(selector)
  const target = elements[index]
  if (!target) throw new Error(`找不到元素：${selector}[${index}]`)
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

const clickByText = async (selector: string, text: string) => {
  const elements = [...document.body.querySelectorAll(selector)] as HTMLElement[]
  const target = elements.find((element) => element.textContent?.includes(text))
  if (!target) throw new Error(`找不到文案为「${text}」的元素：${selector}`)
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

const setInput = async (index: number, value: string) => {
  const inputs = document.body.querySelectorAll('input')
  const input = inputs[index]
  if (!input) throw new Error(`找不到第 ${index} 个输入框`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

const calledCommand = (command: string) => invokeMock.mock.calls.find((call) => call[0] === command)

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('SkillCreateModal', () => {
  it('选择页列出四种添加方式', async () => {
    invokeMock.mockResolvedValue(null)
    await mountModal()

    const text = document.body.textContent ?? ''
    expect(text).toContain('手动创建')
    expect(text).toContain('从本地导入')
    expect(text).toContain('从 URL 导入')
    expect(text).toContain('从运行时复制')
  })

  it('输入框上限按规范：名称 64、描述 1024', async () => {
    invokeMock.mockResolvedValue(null)
    await mountModal('manual')

    const nameInput = document.body.querySelector('input') as HTMLInputElement
    expect(nameInput.getAttribute('maxlength')).toBe('64')

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.getAttribute('maxlength')).toBe('1024')
  })

  it('只有一个关闭按钮（用卡片自带的，不自己再画一个）', async () => {
    invokeMock.mockResolvedValue(null)
    await mountModal()

    const closes = document.body.querySelectorAll('[aria-label="close"], .close-button')
    expect(closes).toHaveLength(1)
  })

  it('选择页窄、进入具体方式后变宽', async () => {
    invokeMock.mockResolvedValue(null)
    await mountModal()

    const width = () => document.body.querySelector<HTMLElement>('.n-modal')?.style.width
    expect(width()).toBe('460px')

    await clickByText('.method', '从 URL 导入')
    expect(width()).toBe('560px')
  })

  it('URL 导入的来源提示每个占一整行', async () => {
    invokeMock.mockResolvedValue(null)
    await mountModal('url')

    const grid = document.body.querySelector('.hint-grid')
    expect(grid).not.toBeNull()
    const hints = grid!.querySelectorAll('.hint')
    expect(hints).toHaveLength(3)
    // 整行：名称与链接在同一行，链接占满剩余宽度
    for (const hint of hints) {
      expect(hint.querySelector('.hint-name')).not.toBeNull()
      expect(hint.querySelector('.hint-host')).not.toBeNull()
    }
  })

  it('手动创建会调 skills_create_manual 并回传新建的 skill', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_create_manual' ? Promise.resolve(skillInfo) : Promise.resolve(null),
    )
    const wrapper = await mountModal('manual')

    await setInput(0, '市场报告生成器')
    await clickByText('button', '创建 skill')

    expect(calledCommand('skills_create_manual')).toBeTruthy()
    expect(invokeMock.mock.calls[0]).toEqual([
      'skills_create_manual',
      { name: '市场报告生成器', description: '' },
    ])
    expect(wrapper.emitted('created')?.[0]).toEqual([skillInfo])
  })

  it('URL 导入会调 skills_import_url', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_import_url' ? Promise.resolve(skillInfo) : Promise.resolve(null),
    )
    const wrapper = await mountModal('url')

    await setInput(0, 'https://clawhub.ai/owner/skill')
    await clickByText('button', '导入')

    expect(invokeMock.mock.calls[0]).toEqual([
      'skills_import_url',
      { url: 'https://clawhub.ai/owner/skill' },
    ])
    expect(wrapper.emitted('created')?.[0]).toEqual([skillInfo])
  })

  it('本地导入先选路径再调 skills_import_local', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_pick_source') return Promise.resolve('C:/skills/demo')
      if (command === 'skills_import_local') return Promise.resolve(skillInfo)
      return Promise.resolve(null)
    })
    const wrapper = await mountModal('local')

    await clickByText('button', '选择文件夹')
    expect(calledCommand('skills_pick_source')?.[1]).toEqual({ kind: 'folder' })

    await clickByText('button', '导入')
    expect(calledCommand('skills_import_local')?.[1]).toEqual({ path: 'C:/skills/demo' })
    expect(wrapper.emitted('created')?.[0]).toEqual([skillInfo])
  })

  it('运行时复制会列出候选并调 skills_import_runtime', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list_runtime') return Promise.resolve([runtimeSkill])
      if (command === 'skills_import_runtime') return Promise.resolve(skillInfo)
      return Promise.resolve(null)
    })
    const wrapper = await mountModal('runtime')

    expect(document.body.textContent).toContain('pdf-tools')

    await click('.n-checkbox')
    await clickByText('button', '复制到工作区')

    expect(calledCommand('skills_import_runtime')?.[1]).toEqual({ path: runtimeSkill.path })
    expect(wrapper.emitted('created')?.[0]).toEqual([skillInfo])
  })

  it('运行时复制支持搜索过滤', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_list_runtime') {
        return Promise.resolve([
          { ...runtimeSkill, name: 'pdf-tools', runtime: 'Claude Code' },
          { ...runtimeSkill, name: 'web-scrap', runtime: 'Codex', path: 'C:/skills/web-scrap' },
        ])
      }
      return Promise.resolve(null)
    })
    await mountModal('runtime')

    expect(document.body.textContent).toContain('pdf-tools')
    expect(document.body.textContent).toContain('web-scrap')

    await setInput(0, 'web')

    expect(document.body.textContent).toContain('web-scrap')
    expect(document.body.textContent).not.toContain('pdf-tools')

    await setInput(0, '不存在的')
    expect(document.body.textContent).toContain('没有匹配的 skill')
  })

  it('导入失败时展示后端返回的原因', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_import_url'
        ? Promise.reject(new Error('导入失败：没有取到 SKILL.md'))
        : Promise.resolve(null),
    )
    await mountModal('url')

    await setInput(0, 'https://example.com/skill')
    await clickByText('button', '导入')

    expect(document.body.textContent).toContain('没有取到 SKILL.md')
  })
})
