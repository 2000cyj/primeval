// @vitest-environment node
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isTrustedSender, type SenderPolicy } from './sender'

const devPolicy: SenderPolicy = { kind: 'dev-server', origin: 'http://localhost:5174' }

// 用临时目录拼出跨平台的入口文件路径,避免 Windows / POSIX 的 file:// 差异
const entryFile = path.resolve('/app/out/renderer/index.html')
const filePolicy: SenderPolicy = { kind: 'local-file', filePath: entryFile }
const fileUrl = (target: string): string => pathToFileURL(target).href

describe('isTrustedSender(dev-server)', () => {
  it('只信任本机 dev server 的 origin', () => {
    expect(isTrustedSender('http://localhost:5174/', devPolicy)).toBe(true)
    expect(isTrustedSender('http://127.0.0.1:5174/', devPolicy)).toBe(true)
    expect(isTrustedSender('http://localhost:5173/', devPolicy)).toBe(false)
    expect(isTrustedSender('http://localhost.evil.com:5174/', devPolicy)).toBe(false)
    expect(isTrustedSender('https://example.com:5174/', devPolicy)).toBe(false)
    expect(isTrustedSender('file:///app/index.html', devPolicy)).toBe(false)
  })

  it('拒绝 userinfo 伪装成 dev server 的地址', () => {
    // userinfo 里的 localhost:5174 只是账号密码,真实 host 是 evil.com
    expect(isTrustedSender('http://localhost:5174@evil.com/', devPolicy)).toBe(false)
    expect(isTrustedSender('http://localhost:5174@evil.com:5174/', devPolicy)).toBe(false)
    expect(isTrustedSender('http://evil.com@localhost:5174/', devPolicy)).toBe(false)
  })

  it('空地址一律拒绝', () => {
    expect(isTrustedSender(undefined, devPolicy)).toBe(false)
    expect(isTrustedSender('', devPolicy)).toBe(false)
    expect(isTrustedSender('not a url', devPolicy)).toBe(false)
  })
})

describe('isTrustedSender(local-file)', () => {
  it('只信任实际入口文件', () => {
    expect(isTrustedSender(fileUrl(entryFile), filePolicy)).toBe(true)
    expect(isTrustedSender(fileUrl(path.resolve('/app/out/renderer/other.html')), filePolicy)).toBe(
      false,
    )
    expect(isTrustedSender(fileUrl(path.resolve('/app/out/main/index.js')), filePolicy)).toBe(false)
    expect(isTrustedSender(fileUrl(`${entryFile}.evil`), filePolicy)).toBe(false)
    expect(isTrustedSender('http://localhost:5174/', filePolicy)).toBe(false)
    expect(isTrustedSender('https://example.com/', filePolicy)).toBe(false)
  })

  it('空地址一律拒绝', () => {
    expect(isTrustedSender(undefined, filePolicy)).toBe(false)
    expect(isTrustedSender('', filePolicy)).toBe(false)
  })
})
