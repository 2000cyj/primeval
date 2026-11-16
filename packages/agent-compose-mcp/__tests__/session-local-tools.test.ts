/**
 * 本地工具接进转发链路的集成测试。
 *
 * 关注三件事：
 * - tools/list 里既有上游工具，也有本地（Wiki）工具；
 * - tools/call 命中本地工具时**本地执行**，不走上游转发；
 * - 本地工具与上游工具撞名时，本地工具优先（上游改名），上游转发本身不受影响。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { EventBus } from '../src/events.ts'
import { ToolRegistry } from '../src/registry.ts'
import { SessionManager } from '../src/session.ts'
import { UpstreamPool } from '../src/upstream.ts'
import { defaultExposure } from '../src/types.ts'
import type { McpExposure } from '../src/types.ts'
import { createWikiTools } from '../src/wiki.ts'

let root = ''
let pool: UpstreamPool

/** 造一个 Wiki 页面 */
async function writePage(slug: string, title: string, content: string): Promise<void> {
  const dir = join(root, slug)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'page.md'), content, 'utf8')
  await writeFile(
    join(dir, '.meta.json'),
    JSON.stringify({ slug, title, tags: [], parent: null, createdAt: 1, updatedAt: 2 }),
    'utf8',
  )
}

/** 建一个只有本地工具的会话层 */
function makeSession(localTools = createWikiTools(() => root)): SessionManager {
  const bus = new EventBus()
  const registry = new ToolRegistry(pool)
  registry.build(defaultExposure())
  return new SessionManager(pool, registry, bus, undefined, localTools)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentspace-wiki-session-'))
  pool = new UpstreamPool([], new EventBus())
})

afterEach(async () => {
  await pool.closeAll()
  await rm(root, { recursive: true, force: true })
})

describe('会话视图：本地工具', () => {
  it('tools 清单里带上本地工具', () => {
    const session = makeSession()
    const view = session.buildView({ kind: 'all' }, [])
    const names = view.tools.map((tool) => tool.name)
    expect(names).toContain('wiki_list')
    expect(names).toContain('wiki_read')
    expect(names).toContain('wiki_search')
    // 本地工具不进上游路由表
    expect(view.outwardToExposed.has('wiki_read')).toBe(false)
    expect(view.localTools.get('wiki_read')).toBeDefined()
  })

  it('本地工具带描述与 object 类型的 inputSchema', () => {
    const session = makeSession()
    const view = session.buildView({ kind: 'all' }, [])
    const tool = view.tools.find((item) => item.name === 'wiki_search')
    expect(tool?.description).toBeTruthy()
    expect((tool?.inputSchema as { type?: string }).type).toBe('object')
  })
})

describe('会话视图：与上游工具撞名', () => {
  it('本地工具优先，上游工具改名', () => {
    const bus = new EventBus()
    const registry = new ToolRegistry(pool)
    const exposure: McpExposure = {
      serverIds: ['demo'],
      toolKeys: ['demo::wiki_read'],
      maxTools: 10,
    }
    registry.build(exposure, [
      {
        serverId: 'demo',
        serverName: 'Demo',
        tools: [
          {
            serverId: 'demo',
            name: 'wiki_read',
            description: '上游的同名工具',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ])
    const session = new SessionManager(
      pool,
      registry,
      bus,
      undefined,
      createWikiTools(() => root),
    )

    // 单 server 视图：上游工具名不带前缀，于是跟本地工具同名
    const view = session.buildView({ kind: 'server', serverId: 'demo' }, [])
    const names = view.tools.map((tool) => tool.name)
    expect(names).toContain('wiki_read')
    expect(names).toContain('wiki_read_2')
    // 改名后的那个仍然路由回上游
    expect(view.outwardToExposed.get('wiki_read_2')).toBe('demo__wiki_read')
    expect(view.outwardToExposed.has('wiki_read')).toBe(false)
  })

  it('不撞名时上游工具照旧暴露', () => {
    const bus = new EventBus()
    const registry = new ToolRegistry(pool)
    registry.build({ serverIds: ['demo'], toolKeys: ['demo::echo'], maxTools: 10 }, [
      {
        serverId: 'demo',
        serverName: 'Demo',
        tools: [
          {
            serverId: 'demo',
            name: 'echo',
            description: '回声',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ])
    const session = new SessionManager(
      pool,
      registry,
      bus,
      undefined,
      createWikiTools(() => root),
    )

    const view = session.buildView({ kind: 'server', serverId: 'demo' }, [])
    const names = view.tools.map((tool) => tool.name)
    expect(names).toContain('echo')
    expect(view.outwardToExposed.get('echo')).toBe('demo__echo')
  })
})

describe('MCP 端到端：tools/list 与 tools/call', () => {
  it('agent 能列出并调用本地工具', async () => {
    await writePage('deploy', '部署手册', '# 部署手册\n\n先构建再发布。')

    const session = makeSession()
    const view = session.buildView({ kind: 'all' }, [])
    const server = session.createServer(view)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

    const listed = await client.listTools()
    const names = listed.tools.map((tool) => tool.name)
    expect(names).toContain('wiki_list')
    expect(names).toContain('wiki_read')
    expect(names).toContain('wiki_search')

    const result = await client.callTool({ name: 'wiki_read', arguments: { slug: 'deploy' } })
    const text = result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n')
    expect(text).toContain('先构建再发布。')

    const listedResult = await client.callTool({ name: 'wiki_list', arguments: {} })
    const listedText = listedResult.content
      .map((item) => (item.type === 'text' ? item.text : ''))
      .join('\n')
    expect(listedText).toContain('deploy')

    await client.close()
    await server.close()
  })

  it('调用不存在的工具返回工具级错误', async () => {
    const session = makeSession()
    const view = session.buildView({ kind: 'all' }, [])
    const server = session.createServer(view)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

    const result = await client.callTool({ name: 'nope', arguments: {} })
    expect(result.isError).toBe(true)

    await client.close()
    await server.close()
  })
})
