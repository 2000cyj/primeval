import { describe, expect, it } from 'vitest'
import { entryToServerDef } from '../src/registry-client.ts'
import type { McpRegistryEntry } from '../src/types.ts'

/** 造一条目录条目 */
function entry(overrides: Partial<McpRegistryEntry> = {}): McpRegistryEntry {
  return {
    name: 'io.example/thing',
    title: 'Thing',
    ...overrides,
  }
}

describe('目录条目 → 上游定义：认证方式', () => {
  it('远程端点声明了 oauth 段 → 认成 OAuth 授权', () => {
    const def = entryToServerDef(
      entry({
        remotes: [
          {
            url: 'https://mcp.example.com/mcp',
            ...({ oauth: { authorizationUrl: 'https://auth.example.com' } } as object),
          },
        ],
      }),
    )
    expect(def?.auth).toBe('oauth')
  })

  it('远程端点有 authorizationUrl 字段 → 认成 OAuth 授权', () => {
    const def = entryToServerDef(
      entry({
        remotes: [
          {
            url: 'https://mcp.example.com/mcp',
            ...({ authorizationUrl: 'https://auth.example.com' } as object),
          },
        ],
      }),
    )
    expect(def?.auth).toBe('oauth')
  })

  it('远程端点只有认证类请求头 → 认成固定令牌', () => {
    const def = entryToServerDef(
      entry({
        remotes: [
          {
            url: 'https://mcp.example.com/mcp',
            headers: [{ name: 'Authorization' }],
          },
        ],
      }),
    )
    expect(def?.auth).toBe('static')
  })

  it('远程端点什么都不要 → 不需要认证', () => {
    const def = entryToServerDef(entry({ remotes: [{ url: 'https://mcp.example.com/mcp' }] }))
    expect(def?.auth).toBe('none')
  })

  it('本地包带环境变量 → 固定令牌（不是 oauth）', () => {
    const def = entryToServerDef(
      entry({
        packages: [
          {
            registryType: 'npm',
            identifier: '@example/pkg',
            version: '1.0.0',
            environmentVariables: [{ name: 'API_KEY' }],
          },
        ],
      }),
    )
    expect(def?.auth).toBe('static')
    expect(def?.env?.['API_KEY']).toBe('${ENV:API_KEY}')
  })

  it('本地包不带环境变量 → 不需要认证', () => {
    const def = entryToServerDef(
      entry({
        packages: [{ registryType: 'npm', identifier: '@example/pkg', version: '1.0.0' }],
      }),
    )
    expect(def?.auth).toBe('none')
  })
})
