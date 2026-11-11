<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NIcon, NInput, useMessage } from 'naive-ui'
import { Blocks, Copy, Download, Eye, EyeOff, Search, TestTube2, X } from 'lucide-vue-next'
import {
  getProxy,
  scanProxies,
  setProxy,
  testProxy,
  type DetectedProxy,
  type ProxyInfo,
} from '@/api/proxy'
import { getCliStatus, type CliStatus } from '@/api/cli'
import { getVersion } from '@tauri-apps/api/app'

const message = useMessage()

/**
 * 应用版本。
 *
 * 从 Tauri 拿（读的是 `tauri.conf.json` 里的 version），
 * 拿不到时用这个兼底值。
 */
const FALLBACK_VERSION = '1.0.0'
/** 当前版本（从 Tauri 读，兼底值见上） */
const currentVersion = ref(FALLBACK_VERSION)

/**
 * 版本检测地址（留空 —— 后续实现）。
 *
 * 填上之后，「检查最新版本」会去请求它，拿回形如
 * `{ "version": "1.2.0", "url": "https://…/AgentSpace_1.2.0_x64.msi" }` 的 JSON。
 *
 * 留空时按钮点了只会提示「还没配置检测地址」，不会发请求。
 */
const UPDATE_CHECK_URL = ''

/** 检查结果：'idle' 未检查 / 'checking' 检查中 / 'latest' 已是最新 / 'update' 有新版本 */
type UpdateState = 'idle' | 'checking' | 'latest' | 'update'

const updateState = ref<UpdateState>('idle')
/** 检测到的新版本号 */
const latestVersion = ref('')
/** 新版本的下载地址 */
const downloadUrl = ref('')

const hasUpdate = computed(() => updateState.value === 'update')
const isLatest = computed(() => updateState.value === 'latest')

/** 比较两个版本号：a 比 b 新就返回 true */
const isNewer = (a: string, b: string): boolean => {
  const parse = (value: string): number[] =>
    value
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0
    const y = right[index] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** 检查最新版本 */
const checkLatestVersion = async (): Promise<void> => {
  if (!UPDATE_CHECK_URL) {
    message.info('还没配置版本检测地址')
    return
  }
  updateState.value = 'checking'
  try {
    const response = await fetch(UPDATE_CHECK_URL)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const payload = (await response.json()) as { version?: string; url?: string }
    const found = payload.version?.trim() ?? ''
    if (!found) {
      throw new Error('检测结果里没有版本号')
    }
    latestVersion.value = found
    downloadUrl.value = payload.url?.trim() ?? ''
    updateState.value = isNewer(found, currentVersion.value) ? 'update' : 'latest'
    if (updateState.value === 'latest') {
      message.success(`当前已是最新版本 ${currentVersion.value}`)
    }
  } catch (error) {
    updateState.value = 'idle'
    message.error(`检查版本失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 开始更新（下载地址也还没接，先提示） */
const startUpdate = (): void => {
  if (!downloadUrl.value) {
    message.info(`开始更新到 ${latestVersion.value}`)
    return
  }
  void navigator.clipboard?.writeText(downloadUrl.value)
  message.success('下载地址已复制')
}

// ── 全局出站代理 ──

/** 代理地址（不含认证信息） */
const proxyUrl = ref('')
/** 代理认证：用户名 / 密码（可选） */
const proxyUser = ref('')
const proxyPassword = ref('')
/** 是否显示密码 */
const showPassword = ref(false)
/** 改过但还没保存 */
const dirty = ref(false)
/** 当前代理状态 */
const proxyInfo = ref<ProxyInfo | null>(null)
/** 扫到的本地代理 */
const detected = ref<DetectedProxy[]>([])
const saving = ref(false)
const testing = ref(false)
const scanning = ref(false)

/** 命令行工具的安装状态 */
const cli = ref<CliStatus | null>(null)

/** 合成带认证的完整地址：reqwest 认 URL 里的 user:pass */
const fullUrl = computed(() => {
  const base = proxyUrl.value.trim()
  if (!base) return ''
  if (!proxyUser.value.trim()) return base
  const user = encodeURIComponent(proxyUser.value.trim())
  const pass = proxyPassword.value ? `:${encodeURIComponent(proxyPassword.value)}` : ''
  return base.replace(/^(\w+:\/\/)/, `$1${user}${pass}@`)
})

/** 当前生效的代理（界面直接显示） */
const effectiveText = computed(() => {
  const info = proxyInfo.value
  if (!info) return '—'
  if (info.source === 'unset') return '未配置（直连）'
  const source = info.source === 'settings' ? '全局设置' : '环境变量'
  return info.effectiveUrl ? `${info.effectiveUrl}（来源：${source}）` : `直连（来源：${source}）`
})

/** 从完整地址里拆出认证信息 */
const splitAuth = (raw: string): { base: string; user: string; pass: string } => {
  const trimmed = raw.trim()
  if (!trimmed) return { base: '', user: '', pass: '' }
  try {
    const parsed = new URL(trimmed)
    const user = decodeURIComponent(parsed.username || '')
    const pass = decodeURIComponent(parsed.password || '')
    parsed.username = ''
    parsed.password = ''
    return { base: parsed.toString(), user, pass }
  } catch {
    return { base: trimmed, user: '', pass: '' }
  }
}

const copyCliCommand = (): void => {
  void navigator.clipboard?.writeText('agentspace run <智能体名称>')
  message.success('已复制命令')
}

const load = async () => {
  try {
    currentVersion.value = await getVersion()
  } catch {
    currentVersion.value = FALLBACK_VERSION
  }
  try {
    cli.value = await getCliStatus()
  } catch {
    cli.value = null
  }
  try {
    const info = await getProxy()
    proxyInfo.value = info
    const { base, user, pass } = splitAuth(info.savedUrl ?? '')
    proxyUrl.value = base
    proxyUser.value = user
    proxyPassword.value = pass
    dirty.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const markDirty = () => {
  dirty.value = true
}

const save = async () => {
  saving.value = true
  try {
    proxyInfo.value = await setProxy(fullUrl.value)
    dirty.value = false
    message.success(fullUrl.value ? '代理已保存，出站请求会走它' : '已保存，当前直连')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}

const test = async () => {
  if (!fullUrl.value) return
  testing.value = true
  try {
    const result = await testProxy(fullUrl.value)
    if (result.success) {
      message.success(`代理可用，耗时 ${result.latencyMs} ms`)
    } else {
      message.error(`代理不通：${result.error ?? '未知错误'}`)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    testing.value = false
  }
}

const scan = async () => {
  scanning.value = true
  try {
    detected.value = await scanProxies()
    if (!detected.value.length) message.info('没扫到本机代理')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    scanning.value = false
  }
}

const clear = () => {
  proxyUrl.value = ''
  proxyUser.value = ''
  proxyPassword.value = ''
  detected.value = []
  markDirty()
}

/** 点扫到的代理：填进地址栏 */
const pick = (url: string) => {
  const { base, user, pass } = splitAuth(url)
  proxyUrl.value = base
  proxyUser.value = user
  proxyPassword.value = pass
  detected.value = []
  markDirty()
}

onMounted(load)
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">系统设置</h1>
        <p class="page-sub">应用信息与版本更新</p>
      </div>
    </header>

    <div class="card">
      <div class="row">
        <div class="identity">
          <span class="mark" aria-hidden="true">
            <NIcon :size="16">
              <Blocks />
            </NIcon>
          </span>
          <span class="identity-text">
            <span class="identity-name">AgentSpace</span>
            <span class="identity-version tnum">版本 {{ currentVersion }}</span>
          </span>
        </div>

        <!--
          按钮三态：
          - 未检查   → 「检查最新版本」
          - 有新版本 → 「更新到 X.Y.Z」（跟现在一样）
          - 已是最新 → 「已是最新版本」，禁用
        -->
        <NButton
          v-if="!hasUpdate"
          type="primary"
          size="small"
          :loading="updateState === 'checking'"
          :disabled="isLatest"
          @click="checkLatestVersion"
        >
          <template #icon>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
          {{ isLatest ? '已是最新版本' : '检查最新版本' }}
        </NButton>

        <NButton v-else type="primary" size="small" @click="startUpdate">
          <template #icon>
            <NIcon :size="13">
              <Download />
            </NIcon>
          </template>
          更新到 {{ latestVersion }}
        </NButton>
      </div>

      <div v-if="hasUpdate" class="row row-note">
        <span class="note-text">检测到新版本</span>
        <span class="note-version tnum">{{ latestVersion }}</span>
      </div>
    </div>

    <section class="section">
      <header class="section-head">
        <h2 class="section-title">命令行</h2>
        <p class="section-sub">
          在终端里用 <code class="mono">agentspace run &lt;智能体名称&gt;</code> 启动智能体 ——
          会把绑定的 Skills、指令和 MCP 落到当前目录，然后用 Pi 打开。
        </p>
      </header>

      <div class="card">
        <div class="field">
          <div class="field-label">
            安装状态
            <span class="field-hint">
              {{
                cli?.installed
                  ? '已就绪，终端里可以直接敲 agentspace。'
                  : '还没装好 —— 重启一次桌面端会自动补上。'
              }}
            </span>
          </div>
          <div v-if="cli?.path" class="field-row">
            <code class="mono cli-path">{{ cli.path }}</code>
          </div>
        </div>

        <div class="field">
          <div class="field-label">用法</div>
          <div class="field-row">
            <code class="mono cli-cmd">agentspace run &lt;智能体名称&gt;</code>
            <NButton quaternary size="small" @click="copyCliCommand">
              <template #icon>
                <NIcon :size="14">
                  <Copy />
                </NIcon>
              </template>
              复制
            </NButton>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <header class="section-head">
        <h2 class="section-title">网络</h2>
        <p class="section-sub">
          全局出站代理：技能下载、版本检查、MCP 目录搜索等出站请求都经此代理。留空保存即直连。
        </p>
      </header>

      <div class="card">
        <div class="field">
          <label class="field-label" for="proxy-url">代理地址</label>
          <div class="field-row">
            <NInput
              id="proxy-url"
              v-model:value="proxyUrl"
              class="mono"
              placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
              @update:value="markDirty"
              @keyup.enter="dirty && save()"
            />
            <NButton quaternary size="small" :loading="scanning" @click="scan">
              <template #icon>
                <NIcon :size="14">
                  <Search />
                </NIcon>
              </template>
              扫描
            </NButton>
            <NButton quaternary size="small" :loading="testing" :disabled="!fullUrl" @click="test">
              <template #icon>
                <NIcon :size="14">
                  <TestTube2 />
                </NIcon>
              </template>
              测试
            </NButton>
            <NButton quaternary size="small" @click="clear">
              <template #icon>
                <NIcon :size="14">
                  <X />
                </NIcon>
              </template>
              清除
            </NButton>
            <NButton type="primary" size="small" :loading="saving" :disabled="!dirty" @click="save">
              保存
            </NButton>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="proxy-user">认证（可选）</label>
          <div class="field-row">
            <NInput
              id="proxy-user"
              v-model:value="proxyUser"
              class="mono"
              placeholder="用户名"
              @update:value="markDirty"
            />
            <NInput
              v-model:value="proxyPassword"
              class="mono"
              :type="showPassword ? 'text' : 'password'"
              placeholder="密码"
              @update:value="markDirty"
            >
              <template #suffix>
                <button
                  class="eye"
                  type="button"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <NIcon :size="14">
                    <EyeOff v-if="showPassword" />
                    <Eye v-else />
                  </NIcon>
                </button>
              </template>
            </NInput>
          </div>
        </div>

        <div class="row row-note">
          <span class="note-text">当前生效</span>
          <span class="note-value mono">{{ effectiveText }}</span>
        </div>

        <div v-if="detected.length" class="detected">
          <button
            v-for="item in detected"
            :key="item.url"
            type="button"
            class="chip mono"
            @click="pick(item.url)"
          >
            {{ item.url }}
          </button>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.page {
  padding: 20px 24px 32px;
}

.page-head {
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.card {
  width: 100%;
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.row-note {
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  color: #fff;
  background: var(--c-accent);
}

.identity-text {
  display: flex;
  flex-direction: column;
}

.identity-name {
  font-size: 14px;
  font-weight: 600;
}

.identity-version {
  font-size: 12px;
  color: var(--c-text-3);
}

.note-text {
  font-size: 12px;
  color: var(--c-text-3);
}

.note-version {
  font-size: 12px;
  font-weight: 600;
}

/* ── 网络 ── */

.section {
  margin-top: 24px;
}

.section-head {
  margin-bottom: 10px;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.section-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.field {
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border);
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-2);
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.note-value {
  font-size: 12px;
  color: var(--c-text-2);
  word-break: break-all;
}

.eye {
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--c-text-3);
  cursor: pointer;
  background: none;
  border: none;
}

.detected {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.chip {
  padding: 3px 8px;
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 4px;
}

.chip:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
}
.cli-path,
.cli-cmd {
  flex: 1;
  padding: 6px 9px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--c-text);
  word-break: break-all;
}
</style>
