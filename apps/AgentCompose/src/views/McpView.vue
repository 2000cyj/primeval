<script setup lang="ts">
import { onMounted, onUnmounted, ref, type Component } from 'vue'
import { NButton, NIcon, NModal, NSpace, NSwitch, NTag, useMessage } from 'naive-ui'
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Unlink,
} from 'lucide-vue-next'
import {
  buildMcpUrl,
  defaultExposure,
  type McpExposure,
  type McpOAuthState,
  type McpOAuthStatus,
  type McpProfile,
  type McpRuntimeStatus,
  type McpServerDef,
  type McpUpstreamState,
  type McpUpstreamStatus,
} from '@remote/agent-compose-mcp/types'
import {
  authorizeServer,
  ensureSidecar,
  getExposure,
  getStatus,
  listProfiles,
  listServers,
  removeServer,
  saveServers,
  setExposure,
  testServer,
} from '@/api/mcp'
import McpEndpointCard from '@/components/McpEndpointCard.vue'
import McpRegistryModal from '@/components/McpRegistryModal.vue'
import McpServerModal from '@/components/McpServerModal.vue'
import McpExposureDrawer from '@/components/McpExposureDrawer.vue'

const message = useMessage()

const servers = ref<McpServerDef[]>([])
const status = ref<McpRuntimeStatus | null>(null)
const exposure = ref<McpExposure>(defaultExposure())
const profiles = ref<McpProfile[]>([])
const loading = ref(false)
/** 加载失败时的原因（sidecar 没起来等），用于页面顶部提示 */
const loadError = ref('')

/** 新增 / 编辑弹窗 */
const showServerModal = ref(false)
const editingServer = ref<McpServerDef | null>(null)
/** 官方目录搜索弹窗 */
const showRegistryModal = ref(false)
/** 暴露配置抽屉 */
const showExposureDrawer = ref(false)
/** 待删除的 server */
const deleteTarget = ref<McpServerDef | null>(null)

const STATE_META: Record<
  McpUpstreamState,
  { label: string; icon: Component; tone: 'ok' | 'busy' | 'bad' | 'muted' }
> = {
  disabled: { label: '已停用', icon: CircleSlash, tone: 'muted' },
  disconnected: { label: '未连接', icon: Unlink, tone: 'muted' },
  connecting: { label: '连接中', icon: LoaderCircle, tone: 'busy' },
  ready: { label: '已连接', icon: CircleCheck, tone: 'ok' },
  error: { label: '连接失败', icon: CircleAlert, tone: 'bad' },
}

const upstreamOf = (serverId: string): McpUpstreamStatus | undefined =>
  status.value?.upstreams.find((upstream) => upstream.serverId === serverId)

const stateMeta = (serverId: string) => STATE_META[upstreamOf(serverId)?.state ?? 'disconnected']

const toolCount = (serverId: string): number => upstreamOf(serverId)?.tools.length ?? 0

// ── OAuth 授权 ──

/** 轮询间隔：授权是用户在浏览器里异步完成的 */
const OAUTH_POLL_INTERVAL_MS = 3000
/** 轮询上限：超过 2 分钟还没结果就认为用户没走完流程 */
const OAUTH_POLL_TIMEOUT_MS = 120_000

/** 正在发起授权的 server id */
const authorizingId = ref<string | null>(null)
/** 本地记录的授权地址（运行时状态尚未刷新时先给用户一个能点的链接） */
const authorizeUrls = ref<Record<string, string>>({})
/** 等待浏览器回调授权的 server id */
const awaitingAuthorizeIds = ref<string[]>([])

let pollTimer: number | null = null
let pollDeadline = 0

const oauthOf = (serverId: string): McpOAuthStatus | undefined => upstreamOf(serverId)?.oauth

const oauthState = (serverId: string): McpOAuthState => oauthOf(serverId)?.state ?? 'idle'

const authorizeUrlOf = (serverId: string): string | undefined =>
  authorizeUrls.value[serverId] ?? oauthOf(serverId)?.authorizeUrl

const OAUTH_META: Record<
  McpOAuthState,
  { label: string; icon: Component; tone: 'ok' | 'busy' | 'bad' | 'muted' }
> = {
  idle: { label: '未授权', icon: KeyRound, tone: 'muted' },
  pending: { label: '等待授权', icon: LoaderCircle, tone: 'busy' },
  authorized: { label: '已授权', icon: CircleCheck, tone: 'ok' },
  error: { label: '授权失败', icon: CircleAlert, tone: 'bad' },
}

/**
 * 是否在等待授权：状态里已是 pending，或本地刚拿到授权地址但状态尚未刷新。
 * 两者都要把授权链接渲染出来，否则用户点了「授权」会看不到可点的地址。
 */
const isAwaitingAuthorize = (serverId: string): boolean => {
  const state = oauthState(serverId)
  if (state === 'pending') return true
  return state === 'idle' && Boolean(authorizeUrls.value[serverId])
}

const oauthMeta = (serverId: string) => {
  if (isAwaitingAuthorize(serverId)) return OAUTH_META.pending
  return OAUTH_META[oauthState(serverId)]
}

/** 正在等待浏览器授权的 server id */
const pendingOauthIds = (): string[] =>
  servers.value
    .filter((server) => server.auth === 'oauth' && isAwaitingAuthorize(server.id))
    .map((server) => server.id)

const stopPolling = (): void => {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

const schedulePoll = (): void => {
  stopPolling()
  pollTimer = window.setTimeout(() => {
    void pollAuthorize()
  }, OAUTH_POLL_INTERVAL_MS)
}

/** 开始轮询授权状态（已在轮询时不重置超时时间） */
const startPolling = (): void => {
  if (pollTimer === null) pollDeadline = Date.now() + OAUTH_POLL_TIMEOUT_MS
  schedulePoll()
}

const pollAuthorize = async (): Promise<void> => {
  await load({ quiet: true })
  // 授权结果只能在新的运行时状态里看到，逐个核对等待中的 server
  for (const serverId of [...awaitingAuthorizeIds.value]) {
    const server = servers.value.find((item) => item.id === serverId)
    if (!server) continue
    const state = oauthState(serverId)
    if (state === 'authorized') {
      message.success(`${server.name} 授权成功`)
      awaitingAuthorizeIds.value = awaitingAuthorizeIds.value.filter((id) => id !== serverId)
      delete authorizeUrls.value[serverId]
    } else if (state === 'error') {
      message.error(`${server.name} 授权失败：${oauthOf(serverId)?.error ?? '未知错误'}`)
      awaitingAuthorizeIds.value = awaitingAuthorizeIds.value.filter((id) => id !== serverId)
      delete authorizeUrls.value[serverId]
    }
  }
  if (!pendingOauthIds().length) {
    stopPolling()
    return
  }
  if (Date.now() > pollDeadline) {
    stopPolling()
    message.warning('授权等待超时，请重新发起授权')
    return
  }
  schedulePoll()
}

const formatTime = (iso: string | undefined): string => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const serverSubtitle = (server: McpServerDef): string => {
  if (server.transport === 'http') return server.url ?? ''
  const args = server.args?.length ? ` ${server.args.join(' ')}` : ''
  return `${server.command ?? ''}${args}`
}

const load = async (options: { quiet?: boolean } = {}): Promise<void> => {
  if (!options.quiet) loading.value = true
  try {
    // 先确保 sidecar 在跑：它没起来时 admin 调用会失败，
    // 那样在页面里加的 server 实际存不住。
    await ensureSidecar()
    const [serverList, runtime, exposureConfig, profileList] = await Promise.all([
      listServers(),
      getStatus(),
      getExposure(),
      listProfiles(),
    ])
    servers.value = serverList
    status.value = runtime
    exposure.value = exposureConfig
    profiles.value = profileList
    loadError.value = ''
    // 授权是异步的：状态里已有 pending 的 server 意味着用户正在浏览器里走流程
    for (const serverId of pendingOauthIds()) {
      if (!awaitingAuthorizeIds.value.includes(serverId)) {
        awaitingAuthorizeIds.value = [...awaitingAuthorizeIds.value, serverId]
      }
    }
    if (pendingOauthIds().length) startPolling()
  } catch (error) {
    // 不降级成假数据：如实显示失败原因，让用户知道 sidecar 没起来
    const detail = error instanceof Error ? error.message : String(error)
    loadError.value = detail
    console.warn('[mcp] 加载配置失败', error)
    if (!options.quiet) message.error(detail)
  } finally {
    if (!options.quiet) loading.value = false
  }
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  stopPolling()
})

const openCreate = (): void => {
  editingServer.value = null
  showServerModal.value = true
}

const openEdit = (server: McpServerDef): void => {
  editingServer.value = server
  showServerModal.value = true
}

const persistServers = async (next: McpServerDef[]): Promise<void> => {
  await saveServers(next)
  await load()
}

/** 统一的写操作错误提示 */
const reportWriteError = (action: string, error: unknown): void => {
  const detail = error instanceof Error ? error.message : String(error)
  message.error(`${action}失败：${detail}`)
}

const onSaveServer = async (def: McpServerDef): Promise<void> => {
  const exists = servers.value.some((server) => server.id === def.id)
  const next = exists
    ? servers.value.map((server) => (server.id === def.id ? def : server))
    : [...servers.value, def]
  try {
    await persistServers(next)
  } catch (error) {
    reportWriteError(exists ? '更新' : '新增', error)
    return
  }
  showServerModal.value = false
  editingServer.value = null
  message.success(exists ? `已更新：${def.name}` : `已新增：${def.name}`)
}

/** 从官方目录一键添加：目录条目已由 sidecar 翻译成上游定义 */
const onAddFromRegistry = async (def: McpServerDef): Promise<void> => {
  if (servers.value.some((server) => server.id === def.id)) {
    message.warning('已存在同名 server')
    return
  }
  const next = [...servers.value, def]
  try {
    await persistServers(next)
  } catch (error) {
    reportWriteError('新增', error)
    return
  }
  message.success(`已添加：${def.name}`)
}

const onToggleServer = async (server: McpServerDef, enabled: boolean): Promise<void> => {
  const next = servers.value.map((item) => (item.id === server.id ? { ...item, enabled } : item))
  try {
    await persistServers(next)
  } catch (error) {
    reportWriteError(enabled ? '启用' : '停用', error)
    return
  }
  message.success(enabled ? `已启用：${server.name}` : `已停用：${server.name}`)
}

const onDeleteServer = async (): Promise<void> => {
  const target = deleteTarget.value
  if (!target) return
  await removeServer(target.id)
  deleteTarget.value = null
  await load()
  message.success(`已删除：${target.name}`)
}

const onTestServer = async (server: McpServerDef): Promise<void> => {
  const upstream = await testServer(server.id)
  if (!upstream) {
    message.error(`未找到：${server.name}`)
    return
  }
  if (status.value) {
    const upstreams = status.value.upstreams.filter((item) => item.serverId !== upstream.serverId)
    status.value = { ...status.value, upstreams: [...upstreams, upstream] }
  }
  if (upstream.state === 'ready') {
    message.success(`${server.name} 连接成功，${upstream.tools.length} 个工具`)
    return
  }
  if (upstream.state === 'disabled') {
    message.warning(`${server.name} 已停用，未发起连接`)
    return
  }
  message.error(upstream.error ?? `${server.name} 连接失败`)
}

/** 打开授权页：优先用系统浏览器，webview 里被拦时靠卡片上的链接手动打开 */
const openAuthorizePage = (url: string): void => {
  try {
    window.open(url, '_blank')
  } catch (error) {
    console.warn('[mcp] 自动打开授权页面失败，请手动点击授权链接', error)
  }
}

/** 发起 OAuth 授权：拿到授权地址 → 打开浏览器 → 轮询等待授权结果 */
const onAuthorize = async (server: McpServerDef): Promise<void> => {
  authorizingId.value = server.id
  try {
    const result = await authorizeServer(server.id)
    authorizeUrls.value = { ...authorizeUrls.value, [server.id]: result.authorizeUrl }
    if (!awaitingAuthorizeIds.value.includes(server.id)) {
      awaitingAuthorizeIds.value = [...awaitingAuthorizeIds.value, server.id]
    }
    openAuthorizePage(result.authorizeUrl)
    message.info(`请在浏览器中完成授权：${server.name}`)
    startPolling()
  } catch (error) {
    reportWriteError('授权', error)
  } finally {
    authorizingId.value = null
  }
}

const copyText = async (text: string, label: string): Promise<void> => {
  if (!navigator.clipboard) {
    message.warning('当前环境不支持剪贴板，请手动复制')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    message.success(`${label}已复制`)
  } catch {
    message.error('复制失败，请手动选择文本')
  }
}

const copyServerUrl = (server: McpServerDef): void => {
  if (!status.value) return
  const url = buildMcpUrl(
    status.value.endpoint,
    { kind: 'server', serverId: server.id },
    status.value.token,
  )
  void copyText(url, `${server.name} 接入地址`)
}

const onSaveExposure = async (next: McpExposure): Promise<void> => {
  await setExposure(next)
  exposure.value = next
  showExposureDrawer.value = false
  message.success('暴露配置已保存')
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">MCP 管理</h1>
        <p class="page-sub">管理上游 MCP server，并决定哪些工具对外暴露</p>
      </div>
      <NSpace :size="8">
        <NButton size="small" :loading="loading" @click="load()">
          <template #icon>
            <NIcon :size="14">
              <RefreshCw />
            </NIcon>
          </template>
          刷新
        </NButton>
        <NButton size="small" type="primary" @click="openCreate">
          <template #icon>
            <NIcon :size="14">
              <Plus />
            </NIcon>
          </template>
          新增 server
        </NButton>
        <NButton size="small" @click="showRegistryModal = true">
          <template #icon>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
          从目录添加
        </NButton>
      </NSpace>
    </header>

    <div v-if="loadError" class="load-error">
      <NIcon :size="15" color="var(--c-warning, #b45309)">
        <TriangleAlert />
      </NIcon>
      <span class="load-error-text">{{ loadError }}</span>
      <NButton size="tiny" secondary @click="() => load()">重试</NButton>
    </div>

    <McpEndpointCard
      :endpoint="status?.endpoint ?? ''"
      :token="status?.token ?? ''"
      :sessions="status?.sessions ?? 0"
    />

    <section class="block">
      <header class="block-head">
        <div class="block-title">
          <span class="block-name">上游 MCP server</span>
          <span class="block-count tnum">{{ servers.length }}</span>
        </div>
        <NButton size="small" @click="showExposureDrawer = true">
          <template #icon>
            <NIcon :size="14">
              <SlidersHorizontal />
            </NIcon>
          </template>
          配置暴露
        </NButton>
      </header>

      <div v-if="servers.length" class="server-list">
        <article v-for="server in servers" :key="server.id" class="server">
          <div class="server-main">
            <span class="server-icon" aria-hidden="true">
              <NIcon :size="15">
                <Server />
              </NIcon>
            </span>
            <div class="server-text">
              <div class="server-title-row">
                <span class="server-name">{{ server.name }}</span>
                <NTag size="small" :bordered="false">{{ server.transport }}</NTag>
              </div>
              <span class="server-sub mono">{{ serverSubtitle(server) }}</span>
            </div>
          </div>

          <div class="server-state" :class="stateMeta(server.id).tone">
            <NIcon :size="14">
              <component :is="stateMeta(server.id).icon" />
            </NIcon>
            <span class="state-label">{{ stateMeta(server.id).label }}</span>
            <span v-if="upstreamOf(server.id)?.state === 'error'" class="state-error">
              {{ upstreamOf(server.id)?.error }}
            </span>
          </div>

          <div class="server-tools tnum">{{ toolCount(server.id) }} 个工具</div>

          <div class="server-actions">
            <NSwitch
              :value="server.enabled"
              size="small"
              :aria-label="`${server.name} 启停`"
              @update:value="(value: boolean) => onToggleServer(server, value)"
            />
            <NButton size="tiny" secondary @click="onTestServer(server)">
              <template #icon>
                <NIcon :size="13">
                  <Plug />
                </NIcon>
              </template>
              测试
            </NButton>
            <NButton size="tiny" quaternary @click="copyServerUrl(server)">
              <template #icon>
                <NIcon :size="13">
                  <Copy />
                </NIcon>
              </template>
              复制地址
            </NButton>
            <NButton size="tiny" quaternary @click="openEdit(server)">
              <template #icon>
                <NIcon :size="13">
                  <Pencil />
                </NIcon>
              </template>
              编辑
            </NButton>
            <NButton size="tiny" quaternary class="danger-button" @click="deleteTarget = server">
              <template #icon>
                <NIcon :size="13">
                  <Trash2 />
                </NIcon>
              </template>
            </NButton>
          </div>

          <div v-if="server.auth === 'oauth'" class="oauth-row">
            <NIcon :size="14" class="oauth-icon" :class="oauthMeta(server.id).tone">
              <component :is="oauthMeta(server.id).icon" />
            </NIcon>
            <span class="oauth-label">{{ oauthMeta(server.id).label }}</span>
            <span v-if="oauthState(server.id) === 'authorized'" class="oauth-time tnum">
              {{ formatTime(oauthOf(server.id)?.authorizedAt) }}
            </span>
            <span v-if="oauthState(server.id) === 'error'" class="oauth-error">
              {{ oauthOf(server.id)?.error }}
            </span>
            <NButton
              v-if="isAwaitingAuthorize(server.id) && authorizeUrlOf(server.id)"
              tag="a"
              size="tiny"
              secondary
              :href="authorizeUrlOf(server.id)"
              target="_blank"
              rel="noopener"
            >
              <template #icon>
                <NIcon :size="13">
                  <ExternalLink />
                </NIcon>
              </template>
              打开授权页面
            </NButton>
            <NButton
              v-else-if="oauthState(server.id) !== 'authorized'"
              size="tiny"
              secondary
              :loading="authorizingId === server.id"
              @click="onAuthorize(server)"
            >
              <template #icon>
                <NIcon :size="13">
                  <KeyRound />
                </NIcon>
              </template>
              授权
            </NButton>
          </div>
        </article>
      </div>

      <div v-else class="empty card">
        <p class="empty-title">还没有上游 MCP server</p>
        <p class="empty-sub">新增一个 server，连接后即可把它的工具暴露给 agent。</p>
        <NButton size="small" type="primary" @click="openCreate">新增 server</NButton>
      </div>
    </section>

    <section class="card exposure">
      <header class="exposure-head">
        <div>
          <span class="block-name">对外暴露</span>
          <span class="block-sub">只有白名单里的工具会被 agent 看到</span>
        </div>
        <NButton size="small" @click="showExposureDrawer = true">配置暴露</NButton>
      </header>

      <dl class="exposure-stats">
        <div class="stat">
          <dt class="stat-label">可见 server</dt>
          <dd class="stat-value tnum">{{ exposure.serverIds.length }}</dd>
        </div>
        <div class="stat">
          <dt class="stat-label">已选工具</dt>
          <dd class="stat-value tnum">{{ exposure.toolKeys.length }} / {{ exposure.maxTools }}</dd>
        </div>
        <div class="stat">
          <dt class="stat-label">命名组合</dt>
          <dd class="stat-value tnum">{{ profiles.length }}</dd>
        </div>
      </dl>

      <div v-if="profiles.length" class="profile-tags">
        <NTag v-for="profile in profiles" :key="profile.id" size="small" :bordered="false">
          {{ profile.name }} · {{ profile.serverIds.length }} 个 server
        </NTag>
      </div>
    </section>

    <McpServerModal
      :show="showServerModal"
      :server="editingServer"
      @close="showServerModal = false"
      @save="onSaveServer"
    />

    <McpRegistryModal
      :show="showRegistryModal"
      @close="showRegistryModal = false"
      @add="onAddFromRegistry"
    />

    <McpExposureDrawer
      :show="showExposureDrawer"
      :servers="servers"
      :upstreams="status?.upstreams ?? []"
      :exposure="exposure"
      @close="showExposureDrawer = false"
      @save="onSaveExposure"
    />

    <NModal
      :show="deleteTarget !== null"
      preset="card"
      class="confirm-modal"
      style="width: 360px"
      :bordered="false"
      title="删除 server"
      @update:show="(value: boolean) => !value && (deleteTarget = null)"
    >
      <p class="confirm-text">
        确定要删除 <strong>{{ deleteTarget?.name }}</strong> 吗？该操作不可撤销。
      </p>
      <div class="confirm-actions">
        <NButton size="small" @click="deleteTarget = null">取消</NButton>
        <NButton size="small" type="error" @click="onDeleteServer">删除</NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
/* 加载失败提示条 */
.load-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
}

.load-error-text {
  flex: 1;
  font-size: 12px;
  color: var(--c-text-2);
}
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px 32px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.block-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.block-name {
  font-size: 13px;
  font-weight: 600;
}

.block-sub {
  margin-left: 8px;
  font-size: 12px;
  color: var(--c-text-3);
}

.block-count {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-3);
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.2fr) 90px auto;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.server-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.server-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  color: var(--c-text-2);
}

.server-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.server-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.server-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-sub {
  overflow: hidden;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-state {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.server-state.ok {
  color: var(--c-success);
}

.server-state.bad {
  color: var(--c-danger);
}

.server-state.busy {
  color: var(--c-accent);
}

.server-state.busy :deep(svg) {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.state-label {
  flex: none;
}

.state-error {
  overflow: hidden;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-tools {
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.server-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.danger-button {
  color: var(--c-danger);
}

.danger-button:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.oauth-row {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--c-border);
  font-size: 12px;
  color: var(--c-text-3);
}

.oauth-icon.ok {
  color: var(--c-success);
}

.oauth-icon.bad {
  color: var(--c-danger);
}

.oauth-icon.busy {
  color: var(--c-accent);
}

.oauth-icon.busy :deep(svg) {
  animation: spin 1s linear infinite;
}

.oauth-label {
  flex: none;
  color: var(--c-text-2);
}

.oauth-time {
  flex: none;
}

.oauth-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
}

.empty-title {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.empty-sub {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--c-text-3);
}

.exposure {
  padding: 14px 16px;
}

.exposure-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.exposure-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 11px;
  color: var(--c-text-3);
}

.stat-value {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.profile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

.confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 1080px) {
  .server {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 10px;
  }

  .server-tools {
    display: none;
  }
}
</style>
