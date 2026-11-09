/**
 * OAuth 2.1 授权码流程（远程 mcp server 通用）。
 *
 * 远程 mcp server（figma、notion 等）普遍要求 oauth 授权。流程是：
 * 客户端先拿到授权地址，用户在浏览器里登录并同意，授权服务器回调
 * 本机，本机用 code 换 token。
 *
 * 两种进入授权地址的方式：
 *
 * 1. **动态客户端注册（标准做法）**：先向授权服务器的 `/register` 注册，
 *    拿到 client_id 与 client_secret，才能构造授权地址。
 * 2. **本地自选 client_id（降级做法）**：部分服务（figma）的授权端点
 *    不校验 client_id 是否已注册，只在 token 端点才校验。此时跳过注册，
 *    用本地生成并持久化的 client_id 直接构造授权地址 —— 用户照样能在
 *    浏览器里人工授权。
 *
 * 协议细节（pkce、token 交换与刷新）由官方 sdk 的
 * `startAuthorization` / `exchangeAuthorization` 编排，这里负责：
 * - 持久化 client_id、pkce 校验串、state
 * - 把「需要用户去浏览器授权」这件事告诉界面
 * - 接收回调并完成交换
 */
import {
  auth,
  discoverAuthorizationServerMetadata,
  exchangeAuthorization,
  startAuthorization,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { EventBus } from './events.ts'
import type { McpOAuthStatus } from './types.ts'

/** 每个上游的 oauth 持久化数据 */
export type OAuthRecord = {
  /** 客户端注册信息（动态注册的结果） */
  clientInformation?: StoredOAuthClientInformation
  /** 本地自选的 client_id（跳过动态注册时使用） */
  localClientId?: string
  /** 令牌 */
  tokens?: StoredOAuthTokens
  /** pkce 校验串 */
  codeVerifier?: string
  /** state 参数 */
  state?: string
  /** 最近一次成功授权时间 */
  authorizedAt?: string
  /** 资源服务器的元数据地址 */
  resourceMetadataUrl?: string
}

/**
 * 令牌存储接口。
 *
 * 允许异步 —— 文件型存储读写是异步的，sdk 的 provider 接口也允许返回 promise。
 */
export type OAuthStore = {
  read(serverId: string): OAuthRecord | undefined | Promise<OAuthRecord | undefined>
  write(serverId: string, record: OAuthRecord): void | Promise<void>
}

/** 授权结果 */
export type AuthorizeResult = {
  /** 需要用户打开的授权地址 */
  authorizeUrl: string
  scope?: string
}

/**
 * 解析 www-authenticate 头里的授权参数。
 *
 * 形如：`Bearer resource_metadata="...", scope="mcp:connect", authorization_uri="..."`
 */
export function parseAuthChallenge(header: string): {
  resourceMetadataUrl?: string
  scope?: string
  authorizationUri?: string
} {
  const params: Record<string, string> = {}
  const pattern = /([a-zA-Z_]+)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(header)) !== null) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) params[key] = value
  }
  return {
    resourceMetadataUrl: params['resource_metadata'],
    scope: params['scope'],
    authorizationUri: params['authorization_uri'],
  }
}

/**
 * 探测远程 server 的授权要求。
 *
 * 直接发一次 initialize 请求，读 401 响应里的 www-authenticate 头，
 * 拿到资源服务器元数据地址与 scope。
 */
export async function probeAuthChallenge(serverUrl: string): Promise<{
  resourceMetadataUrl?: string
  scope?: string
  /** 授权服务器地址（资源服务器元数据里声明的） */
  authorizationServers?: string[]
}> {
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'agent-compose', version: '0.1.0' },
      },
    }),
  })

  const challenge = response.headers.get('www-authenticate')
  if (!challenge) return {}
  const params = parseAuthChallenge(challenge)

  // 资源服务器元数据里声明了授权服务器地址 —— 授权端点通常不在
  // 资源服务器本域（如 figma 的 mcp.figma.com → api.figma.com）
  let authorizationServers: string[] | undefined
  if (params.resourceMetadataUrl) {
    try {
      const meta = await fetch(params.resourceMetadataUrl, {
        headers: { Accept: 'application/json' },
      })
      if (meta.ok) {
        const body = (await meta.json()) as { authorization_servers?: unknown }
        if (Array.isArray(body.authorization_servers)) {
          authorizationServers = body.authorization_servers.filter(
            (item): item is string => typeof item === 'string',
          )
        }
      }
    } catch {
      // 读不到就退回用资源服务器自身作为授权服务器
    }
  }

  return {
    resourceMetadataUrl: params.resourceMetadataUrl,
    scope: params.scope,
    authorizationServers,
  }
}

/**
 * 把授权错误翻译成用户能看懂的话。
 *
 * 动态客户端注册被拒（403）时不再直接失败：某些服务只放行白名单内的
 * 客户端注册，但授权端点仍然接受未注册的 client_id，此时会降级为
 * 「本地自选 client_id」继续走浏览器人工授权。
 */
export function explainAuthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/Dynamic Client Registration rejected|403/i.test(raw)) {
    return (
      '该远程 server 拒绝了本应用的客户端注册（403）。' +
      '若浏览器仍能打开授权页面，可继续人工授权；' +
      '否则请改用固定令牌认证，或改用该服务的本地版本。'
    )
  }
  return raw
}

/** 生成 url 安全的随机串 */
function randomString(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')
}

/** 判断错误是否来自动态客户端注册被拒 */
function isRegistrationRejected(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error)
  return /Dynamic Client Registration rejected|Registration.*403|403.*registration/i.test(raw)
}

export class OAuthManager {
  /** 授权状态（按 server id） */
  private readonly states = new Map<string, McpOAuthStatus>()
  /** 授权过程中捕获到的授权地址 */
  private readonly pendingUrls = new Map<string, string>()
  /** 授权服务器地址（按 server id） */
  private readonly authorizationServers = new Map<string, string>()
  /** 本机回调地址前缀 */
  private baseUrl = 'http://127.0.0.1:7801'

  private readonly store: OAuthStore
  private readonly bus: EventBus

  constructor(store: OAuthStore, bus: EventBus) {
    this.store = store
    this.bus = bus
  }

  /** 当前授权状态 */
  getStatus(serverId: string): McpOAuthStatus {
    return this.states.get(serverId) ?? { state: 'idle' }
  }

  /**
   * 设置本机回调地址前缀。
   *
   * 端口要等 http 服务起来才知道，因此创建管理器时还没有 —— 回调地址
   * 必须在发起授权前已确定，所以这里在启动后立刻补上。
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private setStatus(serverId: string, status: McpOAuthStatus): void {
    this.states.set(serverId, status)
    this.bus.emit('upstream-status', {
      serverId,
      state: status.state === 'authorized' ? 'ready' : 'disconnected',
      tools: [],
      reconnectAttempt: 0,
      oauth: status,
    })
  }

  /**
   * 准备一个授权地址（用于「测试连接」时直接引导用户去授权）。
   *
   * 与 {@link startAuthorization} 的区别：已存在待用的授权地址时直接复用，
   * 不重复发起。
   */
  async prepareAuthorization(
    serverId: string,
    serverUrl: string,
  ): Promise<{ authorizeUrl: string; scope?: string }> {
    const existing = this.pendingUrls.get(serverId)
    const current = this.states.get(serverId)
    if (existing && current?.state === 'pending') {
      return { authorizeUrl: existing, scope: current.scope }
    }
    return this.startAuthorization(serverId, serverUrl)
  }

  /**
   * 发起授权：返回需要用户在浏览器打开的地址。
   *
   * 优先走标准的动态注册；注册被拒时降级为「本地自选 client_id」，
   * 只要授权端点接受未注册的 client_id，用户照样能人工授权。
   */
  async startAuthorization(serverId: string, serverUrl: string): Promise<AuthorizeResult> {
    this.setStatus(serverId, { state: 'pending' })

    const challenge = await probeAuthChallenge(serverUrl)

    try {
      const provider = this.createProvider(serverId, serverUrl)
      const result = await auth(provider, {
        serverUrl,
        resourceMetadataUrl: challenge.resourceMetadataUrl
          ? new URL(challenge.resourceMetadataUrl)
          : undefined,
        scope: challenge.scope,
      })

      if (result === 'AUTHORIZED') {
        // 已有可用令牌（刷新成功），不需要用户操作
        this.setStatus(serverId, {
          state: 'authorized',
          scope: challenge.scope,
          authorizedAt: new Date().toISOString(),
        })
        return { authorizeUrl: '', scope: challenge.scope }
      }

      const authorizeUrl = this.pendingUrls.get(serverId)
      if (!authorizeUrl) throw new Error('未能生成授权地址')

      this.setStatus(serverId, { state: 'pending', authorizeUrl, scope: challenge.scope })
      return { authorizeUrl, scope: challenge.scope }
    } catch (error) {
      if (isRegistrationRejected(error)) {
        // 注册被拒：改用本地自选 client_id 继续走浏览器授权
        return this.startWithoutRegistration(serverId, serverUrl, challenge)
      }
      const message = explainAuthError(error)
      this.setStatus(serverId, { state: 'error', error: message })
      throw new Error(`发起授权失败：${message}`, { cause: error })
    }
  }

  /**
   * 跳过动态注册，直接用本地自选的 client_id 构造授权地址。
   *
   * 有些服务（figma）的授权端点不校验 client_id 是否已注册，只在
   * token 端点校验。这种情况下跳过注册也能让用户在浏览器里人工授权。
   */
  private async startWithoutRegistration(
    serverId: string,
    serverUrl: string,
    challenge: {
      resourceMetadataUrl?: string
      scope?: string
      authorizationServers?: string[]
    },
  ): Promise<AuthorizeResult> {
    try {
      const record = (await this.store.read(serverId)) ?? {}
      const clientId = record.localClientId ?? `agent-compose-${randomString(8)}`
      const redirectUrl = this.redirectUrl(serverId)

      // 授权服务器元数据：拿 authorization_endpoint / token_endpoint。
      // 授权端点通常不在资源服务器本域（figma 的 mcp.figma.com → api.figma.com），
      // 所以优先用资源服务器元数据里声明的授权服务器。
      const issuer = challenge.authorizationServers?.[0] ?? serverUrl
      const metadata = await discoverAuthorizationServerMetadata(new URL(issuer))
      if (!metadata) throw new Error(`无法获取授权服务器元数据：${issuer}`)
      const authorizationServerUrl = new URL(metadata.authorization_endpoint)
      this.authorizationServers.set(serverId, authorizationServerUrl.origin)

      const started = await startAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation: { client_id: clientId },
        redirectUrl,
        scope: challenge.scope,
        state: record.state ?? randomString(16),
      })

      // 持久化：回调时要用同一个 client_id 与 pkce 校验串
      await this.store.write(serverId, {
        ...record,
        localClientId: clientId,
        codeVerifier: started.codeVerifier,
        state: record.state ?? randomString(16),
      })

      const authorizeUrl = started.authorizationUrl.toString()
      this.setStatus(serverId, {
        state: 'pending',
        authorizeUrl,
        scope: challenge.scope,
      })
      return { authorizeUrl, scope: challenge.scope }
    } catch (error) {
      const message = explainAuthError(error)
      this.setStatus(serverId, { state: 'error', error: message })
      throw new Error(`发起授权失败：${message}`, { cause: error })
    }
  }

  /**
   * 处理浏览器回调：用 code 换 token。
   */
  async handleCallback(serverId: string, serverUrl: string, code: string): Promise<void> {
    try {
      const record = (await this.store.read(serverId)) ?? {}

      // 跳过注册走的那条路：自己换 token
      if (record.localClientId && !record.clientInformation) {
        await this.exchangeWithoutRegistration(serverId, serverUrl, code, record)
      } else {
        const provider = this.createProvider(serverId, serverUrl)
        const result = await auth(provider, { serverUrl, authorizationCode: code })
        if (result !== 'AUTHORIZED') throw new Error('授权未完成')
      }

      const latest = (await this.store.read(serverId)) ?? {}
      this.setStatus(serverId, {
        state: 'authorized',
        scope: latest.tokens?.scope,
        authorizedAt: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus(serverId, { state: 'error', error: message })
      throw new Error(`授权回调处理失败：${message}`, { cause: error })
    }
  }

  /**
   * 跳过注册时用的 token 交换。
   *
   * 未注册的客户端没有 client_secret，服务端可能要求不同的客户端
   * 认证方式，因此依次尝试几种，成功的那个记下来复用。
   */
  private async exchangeWithoutRegistration(
    serverId: string,
    serverUrl: string,
    code: string,
    record: OAuthRecord,
  ): Promise<void> {
    const clientId = record.localClientId
    const codeVerifier = record.codeVerifier
    if (!clientId || !codeVerifier) {
      throw new Error('缺少 client_id 或 pkce 校验串，请重新发起授权')
    }

    // 授权服务器地址：优先用发起授权时记下的，保证与授权请求同一套参数
    const known = this.authorizationServers.get(serverId)
    const metadata = known
      ? await discoverAuthorizationServerMetadata(new URL(known))
      : await discoverAuthorizationServerMetadata(new URL(serverUrl))
    if (!metadata) throw new Error('无法获取授权服务器元数据')
    const authorizationServerUrl = new URL(metadata.authorization_endpoint)
    const redirectUrl = this.redirectUrl(serverId)

    // 依次尝试几种客户端认证方式：未注册的客户端按 public client 处理，
    // 有些服务仍要求带一个（空）密钥
    const attempts: Array<StoredOAuthClientInformation | undefined> = [
      // 未注册的客户端按 public client 处理
      { client_id: clientId },
      // 有些服务仍要求带一个（空）密钥
      { client_id: clientId, client_secret: '' },
      { client_id: clientId, client_secret: clientId },
    ]

    const errors: string[] = []
    for (const clientInformation of attempts) {
      if (!clientInformation) continue
      try {
        const tokens = await exchangeAuthorization(authorizationServerUrl, {
          metadata,
          clientInformation,
          authorizationCode: code,
          codeVerifier,
          redirectUri: redirectUrl,
        })
        await this.store.write(serverId, { ...record, tokens })
        return
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    throw new Error(`换取令牌失败：${errors.join('；')}`)
  }

  /** 该 server 是否已有可用令牌 */
  async hasTokens(serverId: string): Promise<boolean> {
    const record = await this.store.read(serverId)
    return Boolean(record?.tokens?.access_token)
  }

  /**
   * 构造 sdk 需要的 OAuthClientProvider。
   *
   * 动态客户端注册由 sdk 在需要时触发（clientInformation 返回 undefined 时），
   * pkce 校验串由我们保存，供回调时继续使用。
   */
  createProvider(serverId: string, serverUrl: string): OAuthClientProvider {
    const store = this.store
    const redirectUrl = this.redirectUrl(serverId)
    // provider 是对象字面量，其方法里的 this 指向 provider 自身。
    // 这里只捕获局部引用，不引用 manager 本身，避免 this 别名。
    const pendingUrls = this.pendingUrls
    const authorizationServers = this.authorizationServers

    return {
      get redirectUrl(): string {
        return redirectUrl
      },

      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: 'AgentCompose',
          client_uri: 'http://127.0.0.1',
          redirect_uris: [redirectUrl],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          // 部分授权服务器（如 figma）只接受带密钥的客户端认证方式，
          // 这里声明 client_secret_basic，由 sdk 在注册后按需使用
          token_endpoint_auth_method: 'client_secret_basic',
        }
      },

      async clientInformation() {
        const record = await store.read(serverId)
        if (record?.clientInformation) return record.clientInformation
        // 没有注册过：给出本地自选的 client_id，交给降级路径
        if (record?.localClientId) return { client_id: record.localClientId }
        return undefined
      },

      async saveClientInformation(clientInformation: StoredOAuthClientInformation) {
        const record = (await store.read(serverId)) ?? {}
        await store.write(serverId, { ...record, clientInformation })
      },

      async tokens() {
        return (await store.read(serverId))?.tokens
      },

      async saveTokens(tokens: StoredOAuthTokens) {
        const record = (await store.read(serverId)) ?? {}
        await store.write(serverId, {
          ...record,
          tokens,
          authorizedAt: new Date().toISOString(),
        })
      },

      async state() {
        const existing = (await store.read(serverId))?.state
        if (existing) return existing
        const value = randomString(16)
        const record = (await store.read(serverId)) ?? {}
        await store.write(serverId, { ...record, state: value })
        return value
      },

      async codeVerifier() {
        const existing = (await store.read(serverId))?.codeVerifier
        if (existing) return existing
        const value = randomString(48)
        const record = (await store.read(serverId)) ?? {}
        await store.write(serverId, { ...record, codeVerifier: value })
        return value
      },

      async saveCodeVerifier(codeVerifier: string) {
        const record = (await store.read(serverId)) ?? {}
        await store.write(serverId, { ...record, codeVerifier })
      },

      redirectToAuthorization(authorizationUrl: URL) {
        // 桌面端不能直接弹浏览器，由界面把地址交给用户
        pendingUrls.set(serverId, authorizationUrl.toString())
      },

      saveAuthorizationServerUrl(authorizationServerUrl: string) {
        authorizationServers.set(serverId, authorizationServerUrl)
      },

      authorizationServerUrl() {
        return authorizationServers.get(serverId)
      },

      async saveResourceUrl(resourceUrl: string) {
        const record = (await store.read(serverId)) ?? {}
        await store.write(serverId, { ...record, resourceMetadataUrl: resourceUrl })
      },

      async resourceUrl() {
        return (await store.read(serverId))?.resourceMetadataUrl ?? serverUrl
      },
    }
  }

  /** 回调地址：指向本机 sidecar 的 oauth 回调路由 */
  private redirectUrl(serverId: string): string {
    return `${this.baseUrl}/oauth/callback?serverId=${encodeURIComponent(serverId)}`
  }
}
