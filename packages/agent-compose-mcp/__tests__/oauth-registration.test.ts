import { describe, expect, it } from 'vitest'
import { hasRealRegistration } from '../src/oauth.ts'
import type { OAuthRecord } from '../src/oauth.ts'

describe('OAuth 注册记录：区分真注册与自造 client_id', () => {
  it('没有 clientInformation → 不算注册', () => {
    expect(hasRealRegistration(undefined)).toBe(false)
    expect(hasRealRegistration({})).toBe(false)
  })

  it('动态注册的结果 → 算真注册', () => {
    const record: OAuthRecord = {
      clientInformation: { client_id: 'registered-client', issuer: 'https://auth.example.com' },
    }
    expect(hasRealRegistration(record)).toBe(true)
  })

  it('client_id 跟 localClientId 一样 → 是早期降级路径自造的，不算真注册', () => {
    // 这正是 figma 那个坑：自造的 client_id 被当成了「已注册」，
    // 之后 sdk 再也不会去试动态注册，于是这个假 client_id 一直生效。
    const record: OAuthRecord = {
      localClientId: 'agent-compose-abc',
      clientInformation: {
        client_id: 'agent-compose-abc',
        issuer: 'https://auth.example.com',
      },
    }
    expect(hasRealRegistration(record)).toBe(false)
  })

  it('localClientId 与 client_id 不同 → 算真注册', () => {
    const record: OAuthRecord = {
      localClientId: 'agent-compose-abc',
      clientInformation: {
        client_id: 'server-issued-client',
        issuer: 'https://auth.example.com',
      },
    }
    expect(hasRealRegistration(record)).toBe(true)
  })
})
