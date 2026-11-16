import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WikiView from '../views/WikiView.vue'

/**
 * Wiki 页面的数据全部来自 tauri command，这里 mock 掉 invoke。
 *
 * md-editor-v3 底下是 CodeMirror，在 jsdom 里跑不动也没必要 ——
 * 这里用 stub 换成一块占位区，测的是「树 / 搜索 / 保存」这些界面逻辑。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('md-editor-v3', () => ({
  MdEditor: {
    name: 'MdEditor',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="md-editor-stub">{{ modelValue }}</div>',
  },
}))

const storedPages = [
  {
    slug: 'dev',
    title: '开发',
    tags: [],
    parent: null,
    createdAt: 1762300000000,
    updatedAt: 1762300000000,
  },
  {
    slug: 'deploy',
    title: '部署手册',
    tags: ['部署'],
    parent: 'dev',
    createdAt: 1762300000000,
    updatedAt: 1762300000000,
  },
  {
    slug: 'roadmap',
    title: '路线图',
    tags: [],
    parent: null,
    createdAt: 1762300000000,
    updatedAt: 1762300000000,
  },
]

const pageOf = (slug: string) => {
  const meta = storedPages.find((item) => item.slug === slug)
  if (!meta) throw new Error(`没有这个页面：${slug}`)
  return { ...meta, content: `# ${meta.title}\n\n正文` }
}

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, WikiView },
    template: '<NMessageProvider><WikiView /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('WikiView', () => {
  it('按 parent 在前端把扁平列表组装成树', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'wiki_list' ? Promise.resolve(storedPages) : Promise.resolve(null),
    )
    const wrapper = await mountView()

    const titles = wrapper.findAll('.node-title').map((node) => node.text())
    expect(titles).toEqual(['开发', '部署手册', '路线图'])
    // 子页面缩进一级
    expect(wrapper.findAll('.node')[1]?.attributes('style')).toContain('22px')
  })

  it('点页面会读正文并填进编辑区', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'wiki_list') return Promise.resolve(storedPages)
      if (command === 'wiki_read') return Promise.resolve(pageOf('deploy'))
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    await wrapper.findAll('.node-main')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('.title-input input').element.value).toBe('部署手册')
    expect(wrapper.get('.md-editor-stub').text()).toContain('部署手册')
  })

  it('搜索命中可以直接进对应页面', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'wiki_list') return Promise.resolve(storedPages)
      if (command === 'wiki_search') {
        return Promise.resolve([
          { slug: 'deploy', title: '部署手册', snippet: '先构建再发布', line: 12 },
        ])
      }
      if (command === 'wiki_read') return Promise.resolve(pageOf('deploy'))
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    await wrapper.get('.side-head input').setValue('部署')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await flushPromises()

    expect(wrapper.findAll('.hit')).toHaveLength(1)
    expect(wrapper.get('.hit-snippet').text()).toBe('先构建再发布')

    await wrapper.get('.hit-main').trigger('click')
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('.title-input input').element.value).toBe('部署手册')
  })

  it('内容改了才能保存，保存时把标签拆成数组', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'wiki_list') return Promise.resolve(storedPages)
      if (command === 'wiki_read') return Promise.resolve(pageOf('roadmap'))
      if (command === 'wiki_save') return Promise.resolve(pageOf('roadmap'))
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    await wrapper.findAll('.node-main')[2]!.trigger('click')
    await flushPromises()

    // 没改东西时保存按钮不可点
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    expect(saveButton?.attributes('disabled')).toBeDefined()

    await wrapper.get('.tags-input input').setValue('产品, 规划')
    await wrapper.vm.$nextTick()

    const enabled = wrapper.findAll('button').find((button) => button.text() === '保存')
    expect(enabled?.attributes('disabled')).toBeUndefined()

    await enabled!.trigger('click')
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'wiki_save')
    expect(call?.[1]).toMatchObject({ slug: 'roadmap', tags: ['产品', '规划'], parent: null })
  })

  it('新建页面后切到新页', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'wiki_list') return Promise.resolve(storedPages)
      if (command === 'wiki_create') {
        return Promise.resolve({
          ...storedPages[2],
          slug: 'new-page',
          title: '新页面',
          parent: null,
          content: '',
        })
      }
      if (command === 'wiki_read') {
        return Promise.resolve({
          ...storedPages[2],
          slug: 'new-page',
          title: '新页面',
          content: '',
        })
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建页面')!
      .trigger('click')
    await wrapper.vm.$nextTick()

    // 弹窗被传送到 body 上，得从 document 里找
    const modalInput = document.body.querySelector<HTMLInputElement>('.n-modal input')
    modalInput!.value = '新页面'
    modalInput!.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const createButton = Array.from(document.body.querySelectorAll('.n-modal button')).find(
      (button) => button.textContent?.trim() === '创建',
    )
    createButton!.dispatchEvent(new Event('click'))
    await flushPromises()

    expect(invokeMock.mock.calls.find((item) => item[0] === 'wiki_create')?.[1]).toEqual({
      title: '新页面',
      parent: null,
    })
    expect(wrapper.get<HTMLInputElement>('.title-input input').element.value).toBe('新页面')
  })

  it('删除要先确认，确认后才调命令', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'wiki_list') return Promise.resolve(storedPages)
      if (command === 'wiki_read') return Promise.resolve(pageOf('roadmap'))
      if (command === 'wiki_delete') return Promise.resolve(null)
      return Promise.resolve(null)
    })
    const wrapper = await mountView()

    await wrapper.findAll('.node-main')[2]!.trigger('click')
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '删除')!
      .trigger('click')
    await wrapper.vm.$nextTick()

    // 还没确认，不能发删除命令
    expect(invokeMock.mock.calls.find((item) => item[0] === 'wiki_delete')).toBeUndefined()

    const confirmButton = Array.from(document.body.querySelectorAll('.n-modal button')).find(
      (button) => button.textContent?.trim() === '删除',
    )
    confirmButton!.dispatchEvent(new Event('click'))
    await flushPromises()

    expect(invokeMock.mock.calls.find((item) => item[0] === 'wiki_delete')?.[1]).toEqual({
      slug: 'roadmap',
    })
  })
})
