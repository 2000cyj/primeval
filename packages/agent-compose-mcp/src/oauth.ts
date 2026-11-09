/**
 * OAuth 2.1 授权码流程（远程 mcp server 通用）。
 *
 * 远程 mcp server（figma、notion 等）普遍要求 oauth 2.1：客户端先拿到
 * 授权地址，用户在浏览器里同意，授权服务器回调本机，本机用 code 换 token。
 *
 * 协议细节（pkce、动态客户端注册、token 交换与刷新）由官方 sdk 的
 * `auth()` 编排，这里只负责：
 * - 提供 sdk 需要的 OAuthClientProvider（存取客户端信息 / 令牌 / pkce）
 * - 把「需要用户去浏览器授权」这件事告诉界面
 * - 接收回调并完成交换
 */
import { auth } from '@modelcontextprotocol/client'
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { EventBus } from './events.ts'
import type { McpOAuthStatus } from './types.ts'

/** 每个上游的 oauth 持久化数据 */
export type OAuthRecord = {
  /** 客户端注册信息（动态注册的结果） */
  clientInformation?: StoredOAuthClientInformation
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
export async function probeAuthChallenge(
  serverUrl: string,
): Promise<{ resourceMetadataUrl?: string; scope?: string }> {
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
  return {
    resourceMetadataUrl: params.resourceMetadataUrl,
    scope: params.scope,
  }
}

/** 生成 url 安全的随机串 */
function randomString(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')
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
   * 发起授权：返回需要用户在浏览器打开的地址。
   */
  async startAuthorization(serverId: string, serverUrl: string): Promise<AuthorizeResult> {
    this.setStatus(serverId, { state: 'pending' })

    try {
      const challenge = await probeAuthChallenge(serverUrl)
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
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus(serverId, { state: 'error', error: message })
      throw new Error(`发起授权失败：${message}`, { cause: error })
    }
  }

  /**
   * 处理浏览器回调：用 code 换 token。
   */
  async handleCallback(serverId: string, serverUrl: string, code: string): Promise<void> {
    try {
      const provider = this.createProvider(serverId, serverUrl)
      const result = await auth(provider, { serverUrl, authorizationCode: code })
      if (result !== 'AUTHORIZED') throw new Error('授权未完成')

      const record = await this.store.read(serverId)
      this.setStatus(serverId, {
        state: 'authorized',
        scope: record?.tokens?.scope,
        authorizedAt: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus(serverId, { state: 'error', error: message })
      throw new Error(`授权回调处理失败：${message}`, { cause: error })
    }
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
        return (await store.read(serverId))?.clientInformation
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
