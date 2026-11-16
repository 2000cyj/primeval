/**
 * 目录客户端：按名字精确取一条。
 *
 * 数据管理导入远程 MCP server 时走这条路 —— 导出包里只有条目名，
 * 定义得现场从目录取回来。
 *
 * 这里用假服务器，不依赖外网：真实目录的接口形态容易变，
 * 钉住「请求打哪、返回怎么解」比依赖真目录更稳。
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { entryToServerDef, fetchRegistryEntry } from '../src/registry-client.ts'

/** 假目录服务的地址（fetchRegistryEntry 里的地址是写死的，所以这里改用注入）。 */
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    // 看原始路径：%2F 不能被解码（否则条目名里的 / 会变成路径分隔符）
    const raw = req.url ?? ''
    if (raw === '/v0/servers/io.github.owner%2Frepo/versions/latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          server: {
            name: 'io.github.owner/repo',
            title: '示例',
            version: '1.2.3',
            packages: [
              {
                registryType: 'npm',
                identifier: '@owner/pkg',
                version: '1.0.0',
                transport: { type: 'stdio' },
              },
            ],
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': { status: 'active' },
          },
        }),
      )
      return
    }
    if (raw === '/v0/servers/missing%2Fthing/versions/latest') {
      res.writeHead(404)
      res.end('{}')
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'object' && address) {
    // base 要带上 /v0/servers —— 函数是在 base 后面拼条目名的
    base = `http://127.0.0.1:${address.port}/v0/servers`
  }
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('目录客户端', () => {
  it('按名字取到条目并翻成上游定义', async () => {
    const entry = await fetchRegistryEntry('io.github.owner/repo', base)
    expect(entry).not.toBeNull()
    if (!entry) throw new Error('条目应该取得到')
    expect(entry.name).toBe('io.github.owner/repo')
    expect(entry.version).toBe('1.2.3')
    // 官方标记要看 _meta —— toEntries 得从单条形态里读出来
    expect(entry.official).toBe(true)

    const def = entryToServerDef(entry)
    expect(def).not.toBeNull()
    expect(def?.id).toBe('io-github-owner-repo')
    expect(def?.transport).toBe('stdio')
  })

  it('条目不在目录里时返回 null（不是抛错）', async () => {
    const entry = await fetchRegistryEntry('missing/thing', base)
    expect(entry).toBeNull()
  })

  it('空名字直接返回 null，不发请求', async () => {
    expect(await fetchRegistryEntry('  ')).toBeNull()
  })
})
