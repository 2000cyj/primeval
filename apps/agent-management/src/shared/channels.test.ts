// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ALLOWED_CHANNELS, IPC_CHANNELS, isAllowedChannel } from './channels'

describe('IPC 频道白名单', () => {
  it('本轮只开放一个只读探针通道', () => {
    expect(ALLOWED_CHANNELS).toEqual(['app:getVersion'])
    expect(IPC_CHANNELS.appVersion).toBe('app:getVersion')
  })

  it('白名单闸门只放行已声明频道', () => {
    expect(isAllowedChannel('app:getVersion')).toBe(true)
    expect(isAllowedChannel('app:setVersion')).toBe(false)
    expect(isAllowedChannel('fs:readFile')).toBe(false)
    expect(isAllowedChannel('')).toBe(false)
  })
})
