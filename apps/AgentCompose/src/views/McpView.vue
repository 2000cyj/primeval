<script setup lang="ts">
import { onMounted, onUnmounted, ref, type Component } from 'vue'
import { NButton, NIcon, NModal, NSpace, NSwitch, NTag, NTooltip, useMessage } from 'naive-ui'
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Copy,
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
  type McpRuntimeStatus,
  type McpServerDef,
  type McpUpstreamState,
  type McpUpstreamStatus,
} from '@remote/agent-compose-mcp/types'
import { secretEnvName } from '@remote/agent-compose-mcp/secret'
import {
  connectServers,
  ensureSidecar,
  getExposure,
  getStatus,
  listServers,
  openUrl,
  refreshToken,
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
/** 刷新 token 中 */
const refreshingToken = ref(false)
const exposure = ref<McpExposure>(defaultExposure())
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

const stateMeta = (serverId: string) => {
  const upstream = upstreamOf(serverId)
  const meta = STATE_META[upstream?.state ?? 'disconnected']
  // 有缓存的工具清单但当前没连上：说明上次连成功过，
  // 显示「上次连接」比一片「未连接」有用得多。
  if (upstream?.toolsFromCache && upstream.state === 'disconnected') {
    return { ...meta, label: '上次连接' }
  }
  return meta
}

const toolCount = (serverId: string): number => upstreamOf(serverId)?.tools.length ?? 0

/** 状态提示里的详情文字：连接失败时给出真实原因，否则为空 */
const stateDetail = (serverId: string): string => {
  const upstream = upstreamOf(serverId)
  if (upstream?.state !== 'error') return ''
  return upstream.error ?? ''
}

// ── OAuth 授权 ──

/** 轮询间隔：授权是用户在浏览器里异步完成的 */
const OAUTH_POLL_INTERVAL_MS = 3000
/** 轮询上限：超过 2 分钟还没结果就认为用户没走完流程 */
const OAUTH_POLL_TIMEOUT_MS = 120_000

let pollTimer: number | null = null
let pollDeadline = 0

const oauthOf = (serverId: string): McpOAuthStatus | undefined => upstreamOf(serverId)?.oauth

const oauthState = (serverId: string): McpOAuthState => oauthOf(serverId)?.state ?? 'idle'

/**
 * 是否在等待授权。
 *
 * 判据是**运行时状态** —— 不依赖「点过哪个按钮」：
 * 授权是在浏览器里异步完成的，触发点可能在弹窗里（新增/编辑），
 * 也可能是上一次的会话留下来的。
 */
const isAwaitingAuthorize = (serverId: string): boolean => oauthState(serverId) === 'pending'

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
  for (const serverId of pendingOauthIds()) {
    const server = servers.value.find((item) => item.id === serverId)
    if (!server) continue
    const state = oauthState(serverId)
    if (state === 'authorized') {
      message.success(`${server.name} 授权成功`)
    } else if (state === 'error') {
      message.error(`${server.name} 授权失败：${oauthOf(serverId)?.error ?? '未知错误'}`)
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

const serverSubtitle = (server: McpServerDef): string => {
  if (server.transport === 'http') return server.url ?? ''
  const args = server.args?.length ? ` ${server.args.join(' ')}` : ''
  return `${server.command ?? ''}${args}`
}

/**
 * 令牌来源说明。
 *
 * 用户最常问的是「令牌到底从哪来的」：
 * - 环境变量 XXX（配置里写的是 ${ENV:XXX}）
 * - 手动配置的固定值
 * - 浏览器授权换来的
 * - 没配令牌
 */
const tokenSourceText = (server: McpServerDef): string | null => {
  // 手动配的令牌（字面量或 env 占位）优先
  const manual = server.token
  if (manual) {
    const envName = secretEnvName(manual)
    return envName ? `令牌来自环境变量 ${envName}` : '令牌为手动配置的固定值'
  }
  // static 认证的令牌在 headers / env 里
  const headerValue = Object.values(server.headers ?? {}).find((value) =>
    /authorization|token|api[-_]?key/i.test(value),
  )
  const envValue = Object.values(server.env ?? {}).find((value) =>
    /token|api[-_]?key|secret/i.test(value),
  )
  const candidate = headerValue ?? envValue
  if (candidate) {
    const envName = secretEnvName(candidate)
    return envName ? `令牌来自环境变量 ${envName}` : '令牌为手动配置的固定值'
  }
  // oauth 授权来的
  if (server.auth === 'oauth') {
    const source = upstreamOf(server.id)?.tokenSource
    if (source === 'oauth') return '令牌来自浏览器授权'
    if (source === 'none') return '尚未授权，需要令牌'
  }
  return null
}

const load = async (options: { quiet?: boolean } = {}): Promise<void> => {
  if (!options.quiet) loading.value = true
  try {
    // 先确保 sidecar 在跑：它没起来时 admin 调用会失败，
    // 那样在页面里加的 server 实际存不住。
    await ensureSidecar()
    const [serverList, runtime, exposureConfig] = await Promise.all([
      listServers(),
      getStatus(),
      getExposure(),
    ])
    servers.value = serverList
    status.value = runtime
    exposure.value = exposureConfig
    loadError.value = ''
    // 授权是异步的：状态里已有 pending 的 server 意味着用户正在浏览器里走流程
    if (pendingOauthIds().length) startPolling()

    // 上游默认惰性连接 —— 不主动连，页面就一直显示「未连接」。
    // 这里让代理把所有启用的上游连一遍，连上的工具清单会落盘。
    void connectServers().catch((error) => {
      console.warn('[mcp] 连接上游失败', error)
    })
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

  // 存完就把它连上，把工具清单落盘 ——
  // 这样刷新页面不用重连就能看到上次拿到过哪些工具。
  // 连接是后台做的，不阻塞界面。
  await load({ quiet: true })
  void connectServers().catch((error) => {
    console.warn('[mcp] 连接上游失败', error)
  })
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

/**
 * 测一个**已保存**的上游。
 *
 * 弹窗里的「测试」测的是还没保存的表单内容；这里的「测试」测的是存好的那个。
 */
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

  // oauth 上游尚未授权：后端已把授权地址带回来，直接打开浏览器
  const authorizeUrl = upstream.oauth?.authorizeUrl
  if (authorizeUrl) {
    await openUrl(authorizeUrl)
    message.info(`请在浏览器中完成授权：${server.name}`)
    startPolling()
    return
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

const copyServerUrl = (server: McpServerDef): void => {
  if (!status.value) return
  const url = buildMcpUrl(
    status.value.endpoint,
    { kind: 'server', serverId: server.id },
    status.value.token,
  )
  void copyText(url, `${server.name} 接入地址`)
}

/** 刷新代理的访问令牌 */
const onRefreshToken = async (): Promise<void> => {
  refreshingToken.value = true
  try {
    const token = await refreshToken()
    if (status.value) status.value = { ...status.value, token }
    message.success('已刷新 token')
  } catch (error) {
    reportWriteError('刷新 token', error)
  } finally {
    refreshingToken.value = false
  }
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
      :refreshing="refreshingToken"
      @refresh-token="onRefreshToken"
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

      <div class="exposure-summary">
        <span class="summary-chip">
          <span class="summary-label">可见 server</span>
          <span class="summary-value tnum">{{ exposure.serverIds.length }}</span>
        </span>
        <span class="summary-chip">
          <span class="summary-label">已选工具</span>
          <span class="summary-value tnum">
            {{ exposure.toolKeys.length }}<span class="summary-max">/ {{ exposure.maxTools }}</span>
          </span>
        </span>
      </div>

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
              <span v-if="tokenSourceText(server)" class="server-token">
                {{ tokenSourceText(server) }}
              </span>
            </div>
          </div>

          <div class="server-state" :class="stateMeta(server.id).tone">
            <NTooltip v-if="stateDetail(server.id)" placement="top" :delay="200" :max-width="420">
              <template #trigger>
                <NIcon :size="14" class="state-icon">
                  <component :is="stateMeta(server.id).icon" />
                </NIcon>
              </template>
              <div class="state-tip-detail">{{ stateDetail(server.id) }}</div>
            </NTooltip>
            <NIcon v-else :size="14">
              <component :is="stateMeta(server.id).icon" />
            </NIcon>
            <span class="state-label">{{ stateMeta(server.id).label }}</span>
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
        </article>
      </div>

      <div v-else class="empty card">
        <p class="empty-title">还没有上游 MCP server</p>
        <p class="empty-sub">新增一个 server，连接后即可把它的工具暴露给 agent。</p>
        <NButton size="small" type="primary" @click="openCreate">新增 server</NButton>
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

.server-token {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-4);
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

/* 状态图标：可悬停查看失败详情 */
.state-icon {
  cursor: help;
}

/* 状态文字标签 */
.state-label {
  flex: none;
}

/* 悬停提示里的错误详情 */
.state-tip-detail {
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-text-3);
  /* 错误详情常带换行（如上游的用法说明），保留原始排版 */
  white-space: pre-wrap;
  word-break: break-word;
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

.exposure-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: -2px;
}

.summary-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: var(--c-surface-sunken);
  font-size: 12px;
  line-height: 1.6;
}

.summary-label {
  color: var(--c-text-3);
}

.summary-value {
  font-weight: 600;
  color: var(--c-text);
}

.summary-max {
  font-weight: 500;
  color: var(--c-text-4);
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
