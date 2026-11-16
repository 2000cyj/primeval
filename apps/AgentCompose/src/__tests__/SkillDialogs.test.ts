import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SkillEditorModal from '../components/SkillEditorModal.vue'
import SkillDuplicateModal from '../components/SkillDuplicateModal.vue'
import SkillDetailDrawer from '../components/SkillDetailDrawer.vue'

/**
 * 弹窗 / 抽屉内容被 teleport 到 body，所以用 document.body 查询元素。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const detail = {
  name: '知识库检索',
  description: '从企业知识库中检索信息',
  path: 'C:/Users/test/.agent-compose/skills/知识库检索',
  source: 'manual',
  enabled: true,
  content: '# 知识库检索\n\n正文内容',
  frontmatter: { name: '知识库检索', description: '从企业知识库中检索信息' },
  files: [
    { rel: 'SKILL.md', size: 120 },
    { rel: 'scripts/query.py', size: 2048 },
  ],
  totalSize: 2168,
  updatedAtMs: 1762300000000,
}

const calledCommand = (command: string) => invokeMock.mock.calls.find((call) => call[0] === command)

const clickByText = async (selector: string, text: string) => {
  const elements = [...document.body.querySelectorAll(selector)] as HTMLElement[]
  const target = elements.find((element) => element.textContent?.includes(text))
  if (!target) throw new Error(`找不到文案为「${text}」的元素：${selector}`)
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

const setValue = async (element: Element, value: string) => {
  const input = element as HTMLInputElement | HTMLTextAreaElement
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

/** 大页面编辑器用了 useMessage，要挂在 MessageProvider 下 */
const mountEditor = () =>
  mount({
    components: { NMessageProvider, SkillEditorModal },
    template: '<NMessageProvider><SkillEditorModal :skill-name="name" /></NMessageProvider>',
    data: () => ({ name: '知识库检索' }),
  })

/** 抽屉里用到 useMessage，要挂在 MessageProvider 下 */
const mountDrawer = (skillName: string) =>
  mount({
    components: { NMessageProvider, SkillDetailDrawer },
    template: '<NMessageProvider><SkillDetailDrawer :skill-name="name" /></NMessageProvider>',
    data: () => ({ name: skillName }),
  })

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('SkillEditorModal（大页面）', () => {
  it('打开时读出真实内容，保存时调 skills_update', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_read') return Promise.resolve(detail)
      if (command === 'skills_update') {
        return Promise.resolve({
          name: '知识库检索 增强版',
          description: '新描述',
          path: detail.path,
          source: 'manual',
          enabled: true,
          updatedAtMs: 1762400000000,
          fileCount: 2,
        })
      }
      return Promise.resolve(null)
    })

    const wrapper = mountEditor()
    await flushPromises()

    // 名称 / 描述都来自后端
    const inputs = document.body.querySelectorAll('input')
    expect((inputs[0] as HTMLInputElement).value).toBe('知识库检索')
    expect((inputs[1] as HTMLInputElement).value).toBe('从企业知识库中检索信息')
    // 正文走 Markdown 编辑器（不是 textarea）
    expect(document.body.querySelector('.markdown-editor')).toBeTruthy()

    await setValue(inputs[0]!, '知识库检索 增强版')
    await setValue(inputs[1]!, '新描述')
    await clickByText('button', '保存')

    const call = calledCommand('skills_update')
    expect(call?.[1]).toEqual({
      name: '知识库检索',
      newName: '知识库检索 增强版',
      description: '新描述',
      content: '# 知识库检索\n\n正文内容',
    })
    expect(wrapper.findComponent(SkillEditorModal).emitted('saved')?.[0]).toBeTruthy()
  })

  it('大页面不超视口：高度按视口算，预览区自己滚', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_read' ? Promise.resolve(detail) : Promise.resolve(null),
    )

    mountEditor()
    await flushPromises()

    // 高度跟着视口走（92vh），不会撑出屏幕
    const card = document.body.querySelector('.n-card') as HTMLElement
    expect(card).toBeTruthy()

    // 编辑区在内容区里，自己滚
    expect(document.body.querySelector('.markdown-editor')).toBeTruthy()
    expect(document.body.querySelector('.preview-scroll')).toBeTruthy()
  })

  it('保存失败时展示后端原因', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_read') return Promise.resolve(detail)
      if (command === 'skills_update') {
        return Promise.reject(new Error('保存 skill 失败：已存在同名 skill'))
      }
      return Promise.resolve(null)
    })

    mountEditor()
    await flushPromises()

    // 改点东西，「保存」才可点（没改动时按钮是禁用的）
    const desc = document.body.querySelectorAll('input')[1] as HTMLInputElement
    await setValue(desc, '新描述')

    await clickByText('button', '保存')

    expect(document.body.textContent).toContain('已存在同名 skill')
  })
})

describe('SkillDuplicateModal', () => {
  it('默认带「副本」后缀，创建时调 skills_duplicate', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'skills_duplicate') {
        return Promise.resolve({
          name: '知识库检索 副本',
          description: '从企业知识库中检索信息',
          path: detail.path,
          source: 'duplicate',
          enabled: true,
          updatedAtMs: 1762400000000,
          fileCount: 2,
        })
      }
      return Promise.resolve(null)
    })

    const wrapper = mount(SkillDuplicateModal, {
      props: { show: true, skillName: '知识库检索' },
    })
    await flushPromises()

    const input = document.body.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('知识库检索 副本')

    await setValue(input, '知识库检索 2')
    await clickByText('button', '创建副本')

    expect(calledCommand('skills_duplicate')?.[1]).toEqual({
      name: '知识库检索',
      newName: '知识库检索 2',
    })
    expect(wrapper.emitted('created')?.[0]).toBeTruthy()
  })
})

describe('SkillDetailDrawer', () => {
  it('展示真实信息：来源、文件清单、占用空间', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_read' ? Promise.resolve(detail) : Promise.resolve(null),
    )

    mountDrawer('知识库检索')
    await flushPromises()

    const text = document.body.textContent ?? ''
    expect(text).toContain('手动创建')
    expect(text).toContain('SKILL.md')
    expect(text).toContain('scripts/query.py')
    expect(text).toContain('2.1 KB')
    expect(text).toContain(detail.path)
    // 不再有假的调用量图
    expect(text).not.toContain('最近调用')
  })

  it('读取失败时展示真实原因', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'skills_read'
        ? Promise.reject(new Error('读取 skill 失败：找不到 skill'))
        : Promise.resolve(null),
    )

    mountDrawer('不存在')
    await flushPromises()

    expect(document.body.textContent).toContain('找不到 skill')
  })
})
