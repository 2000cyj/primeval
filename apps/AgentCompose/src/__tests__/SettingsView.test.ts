import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsView from '../views/SettingsView.vue'

/**
 * 「系统设置 › 网络 › 全局出站代理」的行为。
 * 数据全部来自 tauri command，这里 mock 掉 invoke。
 */
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const proxyInfo = {
  savedUrl: 'http://user:secret@127.0.0.1:7890',
  effectiveUrl: 'http://user:***@127.0.0.1:7890',
  source: 'settings',
}

const stubCommands = (): void => {
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case 'proxy_get':
        return Promise.resolve(proxyInfo)
      case 'proxy_set':
        return Promise.resolve({ ...proxyInfo, savedUrl: 'http://127.0.0.1:7890' })
      case 'proxy_test':
        return Promise.resolve({ success: true, latencyMs: 42, error: null })
      case 'proxy_scan':
        return Promise.resolve([
          { url: 'http://127.0.0.1:7890', proxyType: 'http', port: 7890 },
          { url: 'socks5://127.0.0.1:7890', proxyType: 'socks5', port: 7890 },
        ])
      case 'cli_status':
        return Promise.resolve({
          installed: true,
          path: 'C:/Users/test/.local/bin/agentspace.exe',
          command: 'agentspace',
        })
      default:
        return Promise.resolve(null)
    }
  })
}

const mountView = async () => {
  const wrapper = mount({
    components: { NMessageProvider, SettingsView },
    template: '<NMessageProvider><SettingsView /></NMessageProvider>',
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

afterEach(() => {
  invokeMock.mockReset()
  document.body.innerHTML = ''
})

describe('系统设置 › 网络 › 全局出站代理', () => {
  it('有「网络」这一节，代理卡片在里面', async () => {
    stubCommands()
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('网络')
    expect(wrapper.text()).toContain('全局出站代理')
    // 代理那张卡片的第一个字段（前面还有命令行那一节，别用 find('.field-label')）
    const proxyLabel = wrapper
      .findAll('.field-label')
      .find((label) => label.text().includes('代理地址'))
    expect(proxyLabel?.text()).toBe('代理地址')
  })

  it('读出已保存的代理，并拆出用户名 / 密码', async () => {
    stubCommands()
    const wrapper = await mountView()

    const inputs = wrapper.findAll('input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('http://127.0.0.1:7890/')
    expect((inputs[1].element as HTMLInputElement).value).toBe('user')
    expect((inputs[2].element as HTMLInputElement).value).toBe('secret')
  })

  it('保存时把认证信息并回地址里', async () => {
    stubCommands()
    const wrapper = await mountView()

    await wrapper.find('#proxy-url input').setValue('http://127.0.0.1:7890')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存')
    expect(saveButton).toBeTruthy()
    await saveButton?.trigger('click')
    await flushPromises()

    const call = invokeMock.mock.calls.find((item) => item[0] === 'proxy_set')
    expect(call).toBeTruthy()
    expect(call?.[1]).toEqual({ url: 'http://user:secret@127.0.0.1:7890' })
  })

  it('扫描到的本地代理可以点一下填进地址栏', async () => {
    stubCommands()
    const wrapper = await mountView()

    const scanButton = wrapper.findAll('button').find((button) => button.text().includes('扫描'))
    expect(scanButton).toBeTruthy()
    await scanButton?.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const chips = wrapper.findAll('.chip')
    expect(chips).toHaveLength(2)
    expect(chips[0].text()).toBe('http://127.0.0.1:7890')

    await chips[0].trigger('click')
    await wrapper.vm.$nextTick()
    const input = wrapper.find('#proxy-url input').element as HTMLInputElement
    expect(input.value).toBe('http://127.0.0.1:7890/')
  })
})

describe('系统设置 › 命令行', () => {
  it('显示 agentspace 命令的用法', async () => {
    stubCommands()
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('命令行')
    expect(wrapper.text()).toContain('agentspace run')
  })

  it('装了就说已就绪，并给出命令所在的位置', async () => {
    stubCommands()
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('已就绪')
    expect(wrapper.get('.cli-path').text()).toContain('agentspace.exe')
  })
})
