// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const exposeInMainWorld = vi.fn()
const invoke = vi.fn(() => Promise.resolve('0.0.0'))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke },
}))

describe('preload contextBridge', () => {
  it('只暴露白名单具名方法,不暴露 ipcRenderer / process / require', async () => {
    await import('./index')

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    const [name, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('desktop')
    expect(Object.keys(api).sort()).toEqual(['getAppVersion', 'platform'])
    expect(api['ipcRenderer']).toBeUndefined()
    expect(api['process']).toBeUndefined()
    expect(api['require']).toBeUndefined()
  })

  it('具名方法只走白名单频道', async () => {
    await import('./index')

    const [, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>]
    const getAppVersion = api['getAppVersion'] as () => Promise<string>

    await expect(getAppVersion()).resolves.toBe('0.0.0')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('app:getVersion')
  })
})
