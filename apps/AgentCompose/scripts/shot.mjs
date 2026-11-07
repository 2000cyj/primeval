/**
 * 用 Chrome DevTools Protocol 驱动 headless Edge 截图。
 *
 * 为什么不用 `--screenshot` 参数：那种模式下页面视口与截图尺寸不同步，
 * 定位为 absolute 的浮层（Naive UI 的 drawer 遮罩）会按旧视口尺寸定位，
 * 导致截图里遮罩缺失。CDP 可以先 setDeviceMetricsOverride 再截图，
 * 视口与截图一致，还能顺带做点击交互。
 *
 * 用法：node scripts/shot.mjs <url> <out.png> [width] [height] [clickSteps]
 * clickSteps 支持用 '>>>' 串联多个步骤，逐个点击（每次点击后等 900ms）。
 * 每步可以写 CSS 选择器，或 `text:删除` 按可见文本匹配。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9334
const PROFILE = 'C:/Users/20614/AppData/Local/Temp/edge-shot-profile'

const [, , url, out, widthArg, heightArg, clickSelector] = process.argv
const width = Number(widthArg ?? 1200)
const height = Number(heightArg ?? 700)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const proc = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const connect = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('无法连接到 headless Edge')
}

const main = async () => {
  const page = await connect()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let seq = 0
  await new Promise((resolve) => ws.addEventListener('open', resolve))
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url })
  await sleep(2500)

  // 支持多个步骤，用 '>>>' 分隔，例如 ".row-menu >>> .n-dropdown-option:nth-child(4)"
  for (const step of (clickSelector ?? '')
    .split('>>>')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const expression = step.startsWith('text:')
      ? `(() => {
          const want = ${JSON.stringify(step.slice(5))}
          const hit = [...document.querySelectorAll('button, li, a, div, span')]
            .filter((el) => el.textContent?.trim() === want)
            .pop()
          hit?.click()
        })()`
      : `document.querySelector(${JSON.stringify(step)})?.click()`
    await send('Runtime.evaluate', { expression })
    await sleep(900)
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('saved', out)

  ws.close()
  proc.kill()
}

main().catch((error) => {
  console.error(error.message)
  proc.kill()
  process.exit(1)
})
