import { mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import McpExposureDrawer from '../components/McpExposureDrawer.vue'
import type { McpExposure, McpServerDef, McpUpstreamStatus } from '@remote/agent-compose-mcp/types'

const servers: McpServerDef[] = [
  { id: 'filesystem', name: 'File System', transport: 'stdio', command: 'npx', enabled: true },
  { id: 'idea', name: 'IDEA', transport: 'http', url: 'http://127.0.0.1:6335/mcp', enabled: true },
]

const upstreams: McpUpstreamStatus[] = [
  {
    serverId: 'filesystem',
    state: 'ready',
    tools: [
      { serverId: 'filesystem', name: 'read_file', inputSchema: { type: 'object' } },
      { serverId: 'filesystem', name: 'write_file', inputSchema: { type: 'object' } },
    ],
    reconnectAttempt: 0,
  },
  {
    serverId: 'idea',
    state: 'ready',
    tools: [{ serverId: 'idea', name: 'search', inputSchema: { type: 'object' } }],
    reconnectAttempt: 0,
  },
]

const exposure: McpExposure = {
  serverIds: [],
  toolKeys: [],
  maxTools: 150,
}

/** drawer 是 teleport 到 body 的，所以要从 document 里找 */
const all = (selector: string): Element[] => Array.from(document.body.querySelectorAll(selector))

const groups = (): Element[] => all('.group')

const click = async (element: Element): Promise<void> => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

const mountDrawer = () =>
  mount(NMessageProvider, {
    slots: {
      default: () => h(McpExposureDrawer, { show: true, servers, upstreams, exposure }),
    },
  })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('McpExposureDrawer', () => {
  it('默认收起工具列表，点击可展开/收缩', async () => {
    mountDrawer()
    await nextTick()

    expect(all('.tool-list').length).toBe(0)

    await click(all('.group-toggle')[0])
    expect(all('.tool-list').length).toBe(1)
    expect(all('.tool').length).toBe(2)

    await click(all('.group-toggle')[0])
    expect(all('.tool-list').length).toBe(0)
  })

  it('单独勾选工具时父级变为半选', async () => {
    mountDrawer()
    await nextTick()
    await click(all('.group-toggle')[0])

    await click(all('.tool .n-checkbox')[0])

    expect(groups()[0].querySelector('.group-head .n-checkbox')!.className).toContain(
      'n-checkbox--indeterminate',
    )
  })

  it('全部工具勾选后父级自动变为勾选', async () => {
    mountDrawer()
    await nextTick()
    await click(all('.group-toggle')[0])

    await click(all('.tool .n-checkbox')[0])
    await click(all('.tool .n-checkbox')[1])

    const parent = groups()[0].querySelector('.group-head .n-checkbox')!
    expect(parent.className).not.toContain('n-checkbox--indeterminate')
    expect(parent.className).toContain('n-checkbox--checked')
  })

  it('取消父级会清空该分组所有工具', async () => {
    mountDrawer()
    await nextTick()
    await click(all('.group-toggle')[0])

    await click(all('.tool .n-checkbox')[0])
    await click(all('.tool .n-checkbox')[1])

    await click(groups()[0].querySelector('.group-head .n-checkbox')!)

    const boxes = all('.tool .n-checkbox')
    expect(boxes[0].className).not.toContain('n-checkbox--checked')
    expect(boxes[1].className).not.toContain('n-checkbox--checked')
  })

  it('半选状态下点父级会全选', async () => {
    mountDrawer()
    await nextTick()
    await click(all('.group-toggle')[0])

    await click(all('.tool .n-checkbox')[0])
    await click(groups()[0].querySelector('.group-head .n-checkbox')!)

    const boxes = all('.tool .n-checkbox')
    expect(boxes[0].className).toContain('n-checkbox--checked')
    expect(boxes[1].className).toContain('n-checkbox--checked')
  })

  it('保存时 serverIds 由已选工具推导，不会丢掉单独勾选的 server', async () => {
    const wrapper = mountDrawer()
    await nextTick()

    // 只展开并勾选第二个 server 的一个工具
    await click(all('.group-toggle')[1])
    await click(all('.tool .n-checkbox')[0])

    const saveBtn = all('button').find((b) => b.textContent?.trim() === '保存')!
    await click(saveBtn)

    const emitted = wrapper.findComponent(McpExposureDrawer).emitted('save')
    expect(emitted).toBeTruthy()
    const payload = emitted![0][0] as McpExposure
    expect(payload.serverIds).toEqual(['idea'])
    expect(payload.toolKeys).toEqual(['idea::search'])
  })
})
