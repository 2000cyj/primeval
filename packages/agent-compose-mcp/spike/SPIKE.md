# MCP SDK v2.4.0 Spike Report — `@modelcontextprotocol/server` + `@modelcontextprotocol/client`

**目的**：确定 `packages/agent-compose-mcp`（MCP proxy：对上游是 client，对下游 agent 是 server）
在 SDK **v2.4.0** 下真实可用的 API、import 路径、签名与行为。

**验证环境**

| 项                             | 值                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Node                           | `v24.21.0`（`node -v` 实测；`--experimental-strip-types` 在 Node 24 已默认开启，flag 可留可去） |
| `@modelcontextprotocol/server` | `2.4.0`                                                                                         |
| `@modelcontextprotocol/client` | `2.4.0`                                                                                         |
| 真实 `.d.mts` 位置             | `packages/agent-compose-mcp/node_modules/@modelcontextprotocol/{server,client}/dist/`           |
| 包类型                         | `type: module`（ESM）                                                                           |

**本报告的每段代码都实际运行过。** 运行方式：

```bash
cd packages/agent-compose-mcp
node --experimental-strip-types spike/<file>.ts
```

**类型检查**（spike 目录自带 tsconfig，`tsc --noEmit` 通过）：

```bash
cd packages/agent-compose-mcp
npx tsc --noEmit -p spike/tsconfig.json   # exit 0, 0 errors
```

**一键跑全部 spike**：

```bash
cd packages/agent-compose-mcp
node --experimental-strip-types spike/run-all.ts
```

> **端口占用**：proxy 的端口是**动态分配**的（读 `~/.agent-compose/mcp/port`），
> spike 自己另挑一段（`17801-17803` / `7811-7815` / `7821-7822`）避开即可。
> 占用会报 `Error: listen EADDRINUSE: address already in use 127.0.0.1:<端口>`。

---

## 0. 先决结论（TL;DR）

| #   | 问题                     | 结论                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | server 侧 HTTP 接入      | ✅ `createMcpHandler` 可用，但它是 **Web Standard `fetch(request) => Response`** 形状，**不直接吃 `node:http` 的 `(req, res)`**。生产实现已经改用官方 `@modelcontextprotocol/node` 的 `toNodeHandler`（见 `src/server.ts`）—— 不用自己写桥。                                                            |
| 2   | stateless vs stateful    | ✅ **stateless 完全可用**。`createMcpHandler` 默认就是 **per-request / stateless**：普通 MCP 客户端（默认 `versionNegotiation: 'legacy'`，走 2025 handshake）在**没有任何 session id** 的情况下完整跑通 `initialize → tools/list → tools/call`。`mcp-session-id` 响应头为 `null`。**不需要 stateful。** |
| 3   | client 侧连上游          | ✅ `Client` + `StdioClientTransport` 可用。真实方法名：`client.listTools(params?, options?)` / `client.callTool(params, options?)`，`params` 形状 `{ name, arguments? }`。                                                                                                                              |
| 4   | 鉴权与 Origin 校验       | ✅ 全部可用且签名明确：`requireBearerAuth` 返回一个 **fetch 门禁**；`verifyBearerToken` 是底层；`bearerAuthChallengeResponse` 把 `OAuthError` 映射成 401/403。`validateOriginHeader` / `validateHostHeader` 返回 **判别联合**（`ok: true/false`），不是抛异常。                                         |
| 5   | body 读取                | ✅ `readRequestBody(request, maxBytes?)` → `{ tooLarge: true } \| { tooLarge: false; text }`。`DEFAULT_MAX_REQUEST_BODY_SIZE = 4194304`（4 MiB）。                                                                                                                                                      |
| 6   | 低阶 handler 透传 schema | ✅ **能原样返回上游 JSON Schema，不做 zod 转换**。但 **v2 的 `setRequestHandler` 签名变了**：现在按 **method 字符串** 注册（`'tools/list'`），**不再接受 `ListToolsRequestSchema` 这样的 zod schema 作为第一参数**。`McpServer.registerTool` **仍然存在**。                                             |

### 最大的两个坑（先看这里）

1. **v1 教程全部作废**。`server.setRequestHandler(ListToolsRequestSchema, handler)` 在 v2 **不存在**；
   正确的是 `server.setRequestHandler('tools/list', handler)`。
2. **`createMcpHandler` 不接受 `node:http` 的 `(req, res)`**。它是 `{ fetch(request) => Response }`。
   网上大量 v1 教程用的 `app.post('/mcp', ...)` + `transport.handleRequest(req, res)` 那一套在 v2 已不存在。

---

## 1. Server 侧 HTTP 接入（`createMcpHandler`）

### 真实 import 路径与签名

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-DzlXH0KL.d.mts:495`

```ts
declare function createMcpHandler(
  factory: McpServerFactory,
  options?: CreateMcpHandlerOptions,
): McpHttpHandler
```

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-DzlXH0KL.d.mts`：

```ts
type McpServerFactory = (ctx: McpRequestContext) => McpServer | Server | Promise<McpServer | Server>

interface McpRequestContext {
  era: 'legacy' | 'modern'
  authInfo?: AuthInfo
  requestInfo?: Request
}

interface McpHttpHandler {
  /** Web-standard face: serve one HTTP request and resolve with the response. */
  fetch: (request: Request, options?: McpHandlerRequestOptions) => Promise<Response>
  close: () => Promise<void>
  notify: ServerNotifier // { toolsChanged, promptsChanged, resourcesChanged, resourceUpdated }
  bus: ServerEventBus
}
```

`CreateMcpHandlerOptions`（节选，全部字段见 `createMcpHandler-DzlXH0KL.d.mts`）：

```ts
interface CreateMcpHandlerOptions {
  legacy?: 'stateless' | 'reject' // 默认 'stateless'
  onerror?: (error: Error) => void
  responseMode?: PerRequestResponseMode // 'auto' (默认) | 'sse' | 'json'
  bus?: ServerEventBus
  maxSubscriptions?: number // 默认 1024
  keepAliveMs?: number // 默认 15000
  maxRequestBodySize?: number // 默认 4194304 (4 MiB)
}
```

**公开 barrel 路径**（推荐用这个）：

```ts
import { createMcpHandler } from '@modelcontextprotocol/server'
```

### 挂到 node:http 上（必须自己写桥）

`@modelcontextprotocol/server` **不导出**任何 `node:http` 适配器。文档里说的
`toNodeHandler` / `toWebRequest` 来自 **`@modelcontextprotocol/node`** 包，
该包**在本仓库没有安装**（`node_modules/.pnpm/` 下只有 `client` / `core` / `server` / `sdk@1.29.0`）。

最小桥（`spike/node-http-bridge.ts`，实测可用）：

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export function toWebRequest(req: IncomingMessage, url: string): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const entry of value) headers.append(key, entry)
    else headers.set(key, value)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: 'half', // node fetch 用 stream body 时必须
  })
}

export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
  } finally {
    res.end()
  }
}
```

> ⚠️ 跳过了 `host` / `content-length` / `connection` 等 hop-by-hop 头
> （`Request` 构造器自己会算 `content-length`，手写会冲突）。
> 完整版见 `spike/node-http-bridge.ts`。

### 最小可运行示例（1 个假工具 + node:http）

```ts
import { createServer } from 'node:http'
import { McpServer, createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server'
import { toWebRequest, writeWebResponse } from './node-http-bridge.ts'

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'spike-server', version: '0.0.1' })
  server.registerTool(
    'echo',
    {
      description: 'Echo back the given message.',
      inputSchema: fromJsonSchema<{ message: string }>({
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      }),
    },
    async ({ message }) => ({ content: [{ type: 'text', text: `echo:${message}` }] }),
  )
  return server
})

createServer(async (req, res) => {
  const response = await handler.fetch(toWebRequest(req, `http://127.0.0.1:<端口>${req.url}`))
  await writeWebResponse(res, response)
}).listen(<端口>, '127.0.0.1')
```

### `POST /mcp` 发 `initialize` 的实测结果

```
=== raw initialize POST ===
status          = 200
mcp-session-id  = null          <-- createMcpHandler 默认不产生 session id
content-type    = text/event-stream
body            = event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},
        "serverInfo":{"name":"spike-server","version":"0.0.1"}},"jsonrpc":"2.0","id":1}
```

**`mcp-session-id` 如何出现**：默认**不出现**。`createMcpHandler` 的 2025 分支是
_stateless legacy fallback_（每次请求新建一个 instance + `sessionIdGenerator: undefined`
的 transport），所以响应头里没有 `mcp-session-id`。
只有**手工**使用 `WebStandardStreamableHTTPServerTransport` 且传了
`sessionIdGenerator` 时才会在 `initialize` 响应里带上（见 §2）。

> 注意 `content-type: text/event-stream`：`createMcpHandler` 默认 `responseMode: 'auto'`，
> 当 handler 在结果之前先发出 related message 时会升级成 SSE；纯 request/response
> 场景下 `WebStandardStreamableHTTPServerTransport` 也会走 SSE 分帧。
> 若要强制纯 JSON，用 `createMcpHandler(factory, { responseMode: 'json' })`
> （**注意：`'json'` 模式下 progress/logging 等中途 notification 会被丢弃**）。

### `createMcpHandler` 下的其它实测行为

| 请求                                           | 状态码 | 备注                                                                                              |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `POST` `tools/list`（**没有先发 initialize**） | `200`  | stateless 下不要求先握手                                                                          |
| `POST` `notifications/initialized`             | `202`  | notification，body 为空                                                                           |
| `GET`                                          | `405`  | `"Method not allowed."`（stateless legacy 下 GET/DELETE 是 2025 session 操作，无 session 就 405） |
| `DELETE`                                       | `405`  | 同上                                                                                              |
| `POST` body 超过 `maxRequestBodySize`          | `413`  | `-32000 "Payload Too Large: Request body must not exceed N bytes"`                                |
| 无 `Authorization` 头（挂了 bearer gate）      | `401`  | `WWW-Authenticate: Bearer error="invalid_token", ...`                                             |

---

## 2. stateless vs stateful —— **关键结论**

### 两种 transport 的真实签名

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/index.d.mts:655`

```ts
declare class WebStandardStreamableHTTPServerTransport implements Transport {
  constructor(options?: WebStandardStreamableHTTPServerTransportOptions)
  sessionId?: string
  handleRequest(req: Request, options?: HandleRequestOptions): Promise<Response>
  close(): Promise<void>
  // ...
}

interface WebStandardStreamableHTTPServerTransportOptions {
  sessionIdGenerator?: (() => string) | undefined // 不传 => stateless
  onsessioninitialized?: ((sessionId: string) => void | Promise<void>) | undefined
  onsessionclosed?: ((sessionId: string) => void | Promise<void>) | undefined
  enableJsonResponse?: boolean
  eventStore?: EventStore
  retryInterval?: number
  keepAliveMs?: number // 默认 15000
  maxRequestBodySize?: number // 默认 4194304
  supportedProtocolVersions?: string[]
  // allowedHosts / allowedOrigins / enableDnsRebindingProtection 已 @deprecated
}
```

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-DzlXH0KL.d.mts`

```ts
declare class PerRequestHTTPServerTransport implements Transport {
  constructor(options: PerRequestHTTPServerTransportOptions)
  handleMessage(
    message: JSONRPCRequest | JSONRPCNotification,
    extra?: PerRequestMessageExtra,
  ): Promise<Response>
  close(): Promise<void>
}

interface PerRequestHTTPServerTransportOptions {
  classification: MessageClassification // 必填
  responseMode?: PerRequestResponseMode // 'auto' | 'sse' | 'json'
  keepAliveMs?: number
}

interface PerRequestMessageExtra {
  request?: globalThis.Request
  authInfo?: AuthInfo
}

interface MessageClassification {
  era: 'legacy' | 'modern'
  revision?: string
}
```

> `PerRequestHTTPServerTransport` 是给 **power user 手搓路由**用的：
> 它 **不读 body、不做分类、不做 415 检查**，必须自己先
> `classifyInboundRequest()` + `readRequestBody()`。
> **proxy 不需要走这条路**——`createMcpHandler` 已经把它包好了。

### 实测：三种 wiring 全部跑通完整流程

`spike/spike-server.ts` 用真实 `@modelcontextprotocol/client` 的
`StreamableHTTPClientTransport` 打三种 server wiring：

```
########## wiring=handler (createMcpHandler) ##########
raw initialize: status=200  mcp-session-id=null
real Client: connect OK | sessionId=(none)
             listTools = {"tools":[{"name":"echo",...,"inputSchema":{"type":"object","properties":{"message":{"type":"string"}},"required":["message"]}}]}
             callTool  = {"content":[{"type":"text","text":"echo:hi"}]}

########## wiring=stateless (WebStandard + sessionIdGenerator: undefined) ##########
raw initialize: status=200  mcp-session-id=null
real Client: connect OK | sessionId=(none)
             listTools / callTool 同上，均成功

########## wiring=stateful (WebStandard + sessionIdGenerator: crypto.randomUUID) ##########
raw initialize: status=200  mcp-session-id=64de186e-271f-4493-8e94-8915c5dcfb73
real Client: connect OK | sessionId=9944a5c3-e108-42a5-b145-d9b7ac6c845e
             listTools / callTool 同上，均成功
```

### 👉 直接回答任务里的关键问题

> **普通 MCP 客户端能否在没有 session id 的情况下完成 `initialize → tools/list → tools/call` 全流程？**

**能。** 三点证据：

1. `createMcpHandler`（默认 `legacy: 'stateless'`）的 `initialize` 响应头 `mcp-session-id` 为 `null`，
   但真实客户端照样 `connect()` 成功、`listTools()` 成功、`callTool()` 成功。
2. 手工 stateless wiring（`sessionIdGenerator: undefined`）表现完全一致。
3. `createMcpHandler` 甚至允许 **`tools/list` 不先 `initialize`** 就返回 `200`。

**因此 proxy 的下游（对 agent 暴露 `http://127.0.0.1:<端口>/mcp`）不需要 stateful。**
用 `createMcpHandler` 即可 —— 它同时还支持 2026-07-28 modern era（见 §7）。

### 什么时候才需要 stateful

只有当你需要 **per-session 状态**（会话级订阅、跨请求的服务端状态、agent 侧 SSE 长连接）
时才用 `WebStandardStreamableHTTPServerTransport` + `sessionIdGenerator`。
实测差异（`spike/spike-jsonschema.ts`、`spike/spike-transports.ts`）：

| 场景                          | stateful transport 响应                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `initialize`                  | `200`，响应头 `mcp-session-id: <uuid>`                                                                  |
| 后续请求带**正确** session id | `200`                                                                                                   |
| 后续请求带**错误** session id | `404`，`-32001 "Session not found"`                                                                     |
| `GET`（SSE）不带 session id   | `400`                                                                                                   |
| 客户端自动管理                | ✅ `StreamableHTTPClientTransport` 会自动保存并回带 `mcp-session-id`（实测 `transport.sessionId` 有值） |

> 手写 stateful 时要注意：`tools/list` 不带 session id 会得到
> `400 "Bad Request: Server not initialized"`（因为新建的 transport 还没握手），
> 带**错误** session id 会得到 `404 "Session not found"`。两者可区分。

---

## 3. Client 侧连上游

### 真实 import 路径与签名

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/client/dist/client-BTIWJvaF.d.mts`

```ts
declare class Client extends Protocol<ClientContext> {
  constructor(_clientInfo: Implementation, options?: ClientOptions)
  connect(transport: Transport, options?: ConnectOptions): Promise<void>
  listTools(
    params?: ListToolsRequest['params'],
    options?: CacheableRequestOptions,
  ): Promise<ListToolsResult>
  callTool(
    params: CallToolRequest['params'],
    options?: CallToolRequestOptions,
  ): Promise<CallToolResult>
  getServerVersion(): Implementation | undefined
  getServerCapabilities(): ServerCapabilities | undefined
  close(): Promise<void>
}
```

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/client/dist/stdio.d.mts:54`

```ts
declare class StdioClientTransport implements Transport {
  constructor(server: StdioServerParameters)
  get stderr(): Stream | null
  get pid(): number | null
  start(): Promise<void>
  close(): Promise<void>
  send(message: JSONRPCMessage): Promise<void>
}

type StdioServerParameters = {
  command: string
  args?: string[]
  env?: Record<string, string>
  stderr?: IOType | Stream | number
  cwd?: string
  maxBufferSize?: number // 默认 10 MB
}
```

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/client/dist/index.d.mts:2388`

```ts
declare class StreamableHTTPClientTransport implements Transport {
  constructor(url: URL, opts?: StreamableHTTPClientTransportOptions)
  sessionId?: string
  start(): Promise<void>
  close(): Promise<void>
  send(message: JSONRPCMessage): Promise<void>
}
```

**公开 barrel 路径**：

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio' // 注意是子路径
```

> ⚠️ `StdioClientTransport` **不在** `@modelcontextprotocol/client` 主 barrel 里，
> 必须从 **`@modelcontextprotocol/client/stdio`** 导入。
> `StreamableHTTPClientTransport` **在**主 barrel 里。

### 最小 stdio MCP server（手写 JSON-RPC，不依赖 npx）

`spike/minimal-stdio-server.ts` —— 用 `node:readline` 逐行读 stdin，每行一个 JSON-RPC 消息，
写 stdout（**换行分隔**，不是 LSP 的 `Content-Length` 头）。

必须实现的 4 个方法（这是 MCP stdio 的最小面）：

| 方法                        | 响应                                            |
| --------------------------- | ----------------------------------------------- |
| `initialize`                | `{ protocolVersion, capabilities, serverInfo }` |
| `notifications/initialized` | **不响应**（notification 无 id）                |
| `tools/list`                | `{ tools: [...] }`                              |
| `tools/call`                | `{ content: [{ type: 'text', text }] }`         |

### 最小可运行 client

```ts
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--experimental-strip-types', 'minimal-stdio-server.ts'],
  stderr: 'inherit',
})
const client = new Client({ name: 'spike-client', version: '0.0.1' })
await client.connect(transport) // 这里自动完成 2025 initialize 握手

const listResult = await client.listTools() // -> { tools: [...] }
const callResult = await client.callTool({
  name: 'echo',
  arguments: { message: 'hello', count: 2 },
}) // -> { content: [{ type:'text', text }] }

await client.close()
```

### 实测输出

```
[spike] serverVersion  = {"name":"minimal-stdio-server","version":"0.0.1"}
[spike] serverCaps     = {"tools":{"listChanged":false}}
[spike] listTools keys = [ 'tools' ]
[spike] listTools      = {
  "tools": [
    { "name": "echo", "description": "Echo back the given message.",
      "inputSchema": { "type": "object",
                       "properties": { "message": {"type":"string","description":"Text to echo."},
                                       "count": {"type":"number","minimum":1} },
                       "required": ["message"], "additionalProperties": false } }
  ]
}
[spike] callTool       = { "content": [ { "type": "text", "text": "echo({\"message\":\"hello\",\"count\":2})" } ] }
```

**上游返回的原始 JSON Schema `inputSchema` 在 client 侧是逐字保留的**
（`additionalProperties: false`、`minimum: 1`、`description` 全部在）。

### `connect()` 的版本协商（v2 新增，重要）

`ClientOptions.versionNegotiation` **默认是 `{ mode: 'legacy' }`** —— 即走 2025 handshake，
**不**发 `server/discover` 探测。实测（`spike/spike-transports.ts` C 段）：

```ts
const client = new Client(
  { name: 'modern-client', version: '0.0.1' },
  { versionNegotiation: { mode: 'auto' } }, // 或 { pin: '2026-07-28' }
)
```

→ `connect()` 成功，`transport.sessionId` 为 `(none)`，
`listTools()` 返回带 `_meta['io.modelcontextprotocol/serverInfo']` 的 modern 结果。

**对 proxy 的意义**：下游 agent 用默认 `Client` 时走 2025 legacy 路径，
`createMcpHandler` 的 legacy stateless fallback 正好接住（见 §7）。

### stdio transport 的环境变量继承

`getDefaultEnvironment()` 只继承白名单：
`APPDATA, COMSPEC, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATH, PATHEXT,
PROCESSOR_ARCHITECTURE, PROGRAMDATA, PROGRAMFILES, PROGRAMFILES(X86),
PROGRAMW6432, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERNAME, USERPROFILE, WINDIR`。

**注意 `HOME` 不在里面**，Linux 上需要显式传 `env: { ...process.env }` 或自己拼。

---

## 4. 鉴权与 Origin 校验

### 真实签名（`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/index.d.mts`）

```ts
// :176
declare function requireBearerAuth(
  options: VerifyBearerTokenOptions,
): (request: Request) => Promise<AuthInfo | Response>

// :144
declare function verifyBearerToken(
  authorizationHeader: string | null | undefined,
  options: VerifyBearerTokenOptions,
): Promise<AuthInfo>

// :155
declare function bearerAuthChallengeResponse(
  error: unknown,
  options?: Pick<BearerAuthOptions, 'requiredScopes' | 'resourceMetadataUrl'>,
): Response

// :339
declare function validateOriginHeader(
  originHeader: string | null | undefined,
  allowedOriginHostnames: string[],
): OriginValidationResult

// :344
declare function localhostAllowedOrigins(): string[]

// :195
declare function validateHostHeader(
  hostHeader: string | null | undefined,
  allowedHostnames: string[],
): HostHeaderValidationResult

// :199
declare function localhostAllowedHostnames(): string[]
```

`VerifyBearerTokenOptions extends BearerAuthOptions`：

```ts
interface BearerAuthOptions {
  verifier: OAuthTokenVerifier // { verifyAccessToken(token): Promise<AuthInfo> }
  requiredScopes?: string[]
  resourceMetadataUrl?: string
}
interface VerifyBearerTokenOptions extends BearerAuthOptions {
  expectedResource?: URL // RFC 8707 audience 校验
}

interface AuthInfo {
  token: string
  clientId: string
  scopes: string[]
  expiresAt?: number // 必须有！否则 token 被拒
  resource?: URL
  resourceMetadataUrl?: string
  extra?: Record<string, unknown>
}
```

### 怎么挂到请求处理链上

**推荐顺序**（`spike/spike-http-wiring.ts` 实测）：

```ts
const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] })

const handler = createMcpHandler(
  (ctx) => {
    // ctx.authInfo 在这里可用
    const server = new McpServer({ name: 'wired', version: '0.0.1' })
    server.registerTool(
      'whoami',
      { description: 'Report the authenticated client.' },
      async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              clientId: ctx.authInfo?.clientId ?? null,
              scopes: ctx.authInfo?.scopes ?? [],
              era: ctx.era,
            }),
          },
        ],
      }),
    )
    return server
  },
  { maxRequestBodySize: 1024 },
)

createServer(async (req, res) => {
  const request = toWebRequest(req, url)
  const auth = await gate(request)
  if (auth instanceof Response) {
    await writeWebResponse(res, auth)
    return
  } // 401/403
  const response = await handler.fetch(request, { authInfo: auth })
  await writeWebResponse(res, response)
}).listen(7815, '127.0.0.1')
```

**关键点**：

- `requireBearerAuth` 返回的函数 **resolve 成 `AuthInfo | Response`**。
  必须用 `instanceof Response` 判别（**不能**靠 truthy）。
- 校验通过后把 `authInfo` **显式**传给 `handler.fetch(request, { authInfo })`。
  **SDK 不会自己从 header 里提取 token** —— `createMcpHandler` 是
  "deliberately validation-free" 的。
- `authInfo` 通过 `McpRequestContext.authInfo` 到达 factory，
  factory 可以据此按租户/主体返回不同的 server 实例。

### Origin / Host 校验

SDK 提供 **Web Standard 响应器**（比裸 predicate 更适合直接挂在链上）：

```ts
declare function originValidationResponse(
  req: Request,
  allowedOriginHostnames: string[],
): Response | undefined
declare function hostHeaderValidationResponse(
  req: Request,
  allowedHostnames: string[],
): Response | undefined
```

`createMcpHandler` 文档里给的官方组合写法：

```ts
const rejected =
  hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
  originValidationResponse(request, localhostAllowedOrigins())
return rejected ?? handler.fetch(request)
```

裸 predicate 版本（返回**判别联合**，不抛异常）：

```ts
type OriginValidationResult =
  | { ok: true; origin?: string; hostname?: string }
  | {
      ok: false
      errorCode: 'invalid_origin_header' | 'invalid_origin'
      message: string
      originHeader?: string
      hostname?: string
    }

type HostHeaderValidationResult =
  | { ok: true; hostname: string }
  | {
      ok: false
      errorCode: 'missing_host' | 'invalid_host_header' | 'invalid_host'
      message: string
      hostHeader?: string
      hostname?: string
    }
```

### 实测结果（`spike/spike-auth.ts`）

```
DEFAULT_MAX_REQUEST_BODY_SIZE = 4194304
localhostAllowedHostnames()   = [ 'localhost', '127.0.0.1', '[::1]' ]
localhostAllowedOrigins()     = [ 'localhost', '127.0.0.1', '[::1]' ]

--- verifyBearerToken ---
ok  = {"token":"good-token","clientId":"client-1","scopes":["mcp","read"],
       "expiresAt":1794196016,"resource":"http://127.0.0.1:7801/mcp"}
bad token throws = OAuthError unknown token code= invalid_token
missing scope throws code = insufficient_scope
resource mismatch throws code = invalid_token

--- bearerAuthChallengeResponse ---
status = 401
www-authenticate = Bearer error="invalid_token", error_description="nope"
body = {"error":"invalid_token","error_description":"nope"}
scope status = 403 | www-authenticate = Bearer error="insufficient_scope", error_description="need more"

--- requireBearerAuth ---
good request -> isResponse = false | authInfo = {...}
bad request  -> isResponse = true
  status = 401 | www-authenticate = Bearer error="invalid_token", error_description="unknown token", scope="mcp"
no header   -> isResponse = true
  status = 401 | www-authenticate = Bearer error="invalid_token", error_description="Missing Authorization header", scope="mcp"

--- validateOriginHeader ---
no origin        = {"ok":true}
http://localhost = {"ok":true,"origin":"http://localhost:3000","hostname":"localhost"}
http://127.0.0.1 = {"ok":true,"origin":"http://127.0.0.1:7801","hostname":"127.0.0.1"}
https://evil.com = {"ok":false,"errorCode":"invalid_origin","message":"Invalid Origin: evil.com",...}
null origin      = {"ok":false,"errorCode":"invalid_origin_header","message":"Invalid Origin header: null",...}

--- validateHostHeader ---
localhost:3000  = {"ok":true,"hostname":"localhost"}
127.0.0.1:7801  = {"ok":true,"hostname":"127.0.0.1"}
evil.com        = {"ok":false,"errorCode":"invalid_host","message":"Invalid Host: evil.com",...}
missing         = {"ok":false,"errorCode":"missing_host","message":"Missing Host header"}
```

### ⚠️ 踩坑

1. **`expiresAt` 必须填**。SDK 拒绝没有 `expiresAt`（或已过期）的 token
   （文档明说 "bearer-auth verification rejects tokens whose `AuthInfo.expiresAt` is unset"）。
   用 JWT 时要从 `exp` claim 取。
2. **没有 `Origin` 头 = 放行**（非浏览器客户端不发这个头）。
   但 **`Origin: null`**（opaque context）**会被拒**（`invalid_origin_header`）。
3. **allowlist 只写 hostname，不带 scheme / port**：`['localhost', '127.0.0.1', '[::1]']`。
   IPv6 要带方括号。`<scheme>://*` 通配只在部分场景被认（Firefox 扩展），
   `http://*` / `https://*` **不被认**。
4. **OAuth 错误一律是 `OAuthError`**，用 `OAuthError.isInstance(err)` 或 `instanceof`
   判断；`OAuthErrorCode.InvalidToken = 'invalid_token'`，
   `OAuthErrorCode.InsufficientScope = 'insufficient_scope'`。
5. `bearerAuthChallengeResponse` 对**非** `OAuthError` 一律返回 `500 server_error`。

---

## 5. Body 读取

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/index.d.mts:793,800`：

```ts
/** Default upper bound, in bytes, on a request body read by the HTTP entry points (4 MiB). */
declare const DEFAULT_MAX_REQUEST_BODY_SIZE: number

declare function readRequestBody(
  request: Request,
  maxBytes?: number,
): Promise<{ tooLarge: true } | { tooLarge: false; text: string }>
```

**`DEFAULT_MAX_REQUEST_BODY_SIZE = 4194304`（4 MiB）** —— 实测确认。

### 用法与实测

```ts
const body = await readRequestBody(request, 64)
if (body.tooLarge) return new Response('too large', { status: 413 })
const parsed = JSON.parse(body.text)
```

```
small = {"tooLarge":false,"text":"{\"a\":1}"}
over limit = {"tooLarge":true}
declared too large (Request strips content-length) = {"tooLarge":false,"text":"yyyy…"}
real HTTP request (content-length=100) = {"tooLarge":true}
```

实现细节（读源码 `server/dist/index.mjs:60`）：

- 先看 `content-length`：声明值 > `maxBytes` 就**直接返回 `tooLarge: true`，一个字节都不读**。
- 否则边读边计数，累计超过 `maxBytes` 就返回 `tooLarge: true`。
- 返回的是 **text 字符串**，不是 `Uint8Array`。

> ⚠️ **`Request` 构造器会剥掉你手写的 `content-length`**（fetch 的 forbidden header），
> 所以「声明超限」这条分支**用 `new Request(...)` 测不出来**（会走到流式计数分支）。
> 必须走真实 HTTP 请求才能命中。`spike/spike-auth.ts` 里两种都测了。

### 其它 body 上限入口

| 位置                                       | 选项                 | 默认    | 超限行为                                   |
| ------------------------------------------ | -------------------- | ------- | ------------------------------------------ |
| `createMcpHandler`                         | `maxRequestBodySize` | 4194304 | `413` + `-32000 "Payload Too Large: …"`    |
| `WebStandardStreamableHTTPServerTransport` | `maxRequestBodySize` | 4194304 | `413`                                      |
| `isLegacyRequest`                          | `maxRequestBodySize` | 4194304 | 分类为 `false`，由 modern handler 答 `413` |

实测（`spike/spike-http-wiring.ts`，`maxRequestBodySize: 1024`）：

```
oversized status = 413
oversized body = {"jsonrpc":"2.0","error":{"code":-32000,
  "message":"Payload Too Large: Request body must not exceed 1024 bytes"},"id":null}
```

---

## 6. 低阶 handler 透传 schema

### v2 的 `setRequestHandler` 签名（**变了！**）

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/mcp-BCJHyo7l.d.mts:2540`

```ts
setRequestHandler<M$1 extends RequestMethod>(
  method: M$1,
  handler: (request: RequestTypeMap[M$1], ctx: ContextT)
    => HandlerResultTypeMap[M$1] | Promise<HandlerResultTypeMap[M$1]>,
): void;

setRequestHandler<P extends StandardSchemaV1, R extends StandardSchemaV1 | undefined = undefined>(
  method: string,
  schemas: { params: P; result?: R },
  handler: (params: StandardSchemaV1.InferOutput<P>, ctx: ContextT)
    => InferHandlerResult<R> | Promise<InferHandlerResult<R>>,
): void;
```

> **v1 的 `server.setRequestHandler(ListToolsRequestSchema, handler)` 在 v2 不存在。**
> spec 方法按 **method 字符串** 注册：`'tools/list'`、`'tools/call'`、`'initialize'` …
> 3 参重载 **只用于自定义（非 spec）方法**。

### `Server` 构造与能力声明

```ts
declare class Server extends Protocol<ServerContext> {
  constructor(_serverInfo: Implementation, options?: ServerOptions)
  connect(transport: Transport): Promise<void>
  registerCapabilities(capabilities: ServerCapabilities): void
  oninitialized?: () => void
}
```

### ⚠️ 坑 1：必须先 `registerCapabilities`

```ts
const server = new Server({ name: 'x', version: '1' })
server.setRequestHandler('tools/list', handler)
// SdkError: Server does not support tools (required for tools/list)
//   code: 'CAPABILITY_NOT_SUPPORTED'
```

**修法**（在 `connect()` 之前调用）：

```ts
server.registerCapabilities({ tools: {} })
```

### ⚠️ 坑 2：3 参重载不能用在 spec 方法上

```ts
server.setRequestHandler(
  'tools/list',
  { params: specTypeSchemas.ListToolsRequest, result: specTypeSchemas.ListToolsResult },
  handler,
)
// 运行时：ProtocolError: Invalid params for tools/list: method: Invalid input: expected "tools/list"
```

用自定义方法名则正常（实测 `acme/list` 返回 `{}`）。

### 透传上游 JSON Schema —— 可行，逐字保留

`spike/spike-lowlevel.ts` 实测（上游 schema 含 `additionalProperties`、`minimum`、
嵌套 `oneOf`、`$schema` —— 这些 zod 派生 schema 都不会产生）：

```ts
const server = new Server({ name: 'lowlevel-server', version: '0.0.1' })
server.registerCapabilities({ tools: {} })

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo back the given message.',
      inputSchema: UPSTREAM_INPUT_SCHEMA, // 原样透传
    },
  ],
}))

server.setRequestHandler('tools/call', async (request) => {
  const params = request.params as { name?: string; arguments?: Record<string, unknown> }
  return { content: [{ type: 'text', text: `echo:${JSON.stringify(params.arguments ?? {})}` }] }
})
```

实测输出：

```
[lowlevel] inputSchema deep-equal to upstream = true
[lowlevel] inputSchema keys = [ 'type', 'properties', 'required', 'additionalProperties', '$schema' ]
[lowlevel] $schema preserved = https://json-schema.org/draft/2020-12/schema
[lowlevel] callTool  = {"content":[{"type":"text","text":"echo:{\"message\":\"hi\"}"}]}
```

**结论：`tools/list` 的 `inputSchema` 可以原样透传上游 JSON Schema，零转换。**
（`tools/call` 的 result 也一样 —— 实测 `structuredContent` / `_meta` / `isError` 全部保留。）

### ⚠️ 坑 3：TS 类型很窄

`Tool['inputSchema']` 的类型是：

```ts
{
  type: 'object';                                    // 必须字面量
  properties?: Record<string, JSONValue>;            // JSONValue 递归
  required?: string[];
} & { [k: string]: unknown }
```

所以对象字面量会报 `Type 'string' is not assignable to type '"object"'`，
`properties` 里的 `oneOf` 数组会报 readonly / 索引签名不兼容。
**修法**：显式标注类型：

```ts
const UPSTREAM_INPUT_SCHEMA: {
  type: 'object'
  properties: { [key: string]: JSONValue }
  required: string[]
  additionalProperties: boolean
  $schema: string
} = {/* ... */}
```

`JSONValue` 从 `@modelcontextprotocol/server` 导出（`import { type JSONValue } from '@modelcontextprotocol/server'`）。

> ⚠️ **但运行时没有这些限制** —— 上游发什么，wire 上就是什么（实测 `$schema` 都保留了）。
> 类型窄只是 TS 层面的 friction，可用 `as` / 显式标注绕过。

### `McpServer.registerTool` —— **仍然存在**

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/mcp-BCJHyo7l.d.mts:3373`

```ts
registerTool<OutputArgs extends StandardSchemaWithJSON, InputArgs extends StandardSchemaWithJSON | undefined = undefined>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    icons?: Icon[];
    scopeChallenge?: ScopeChallengeHandler;
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>,
): RegisteredTool;
```

实测确认：`typeof server.registerTool === 'function'` ✅，
`typeof server.toolInputSchemaJson === 'function'` ✅（内部方法，用于 HTTP 入口的
SEP-2243 `Mcp-Param-*` 预校验）。

### 高层 `McpServer` 也能透传原始 JSON Schema —— 用 `fromJsonSchema`

`packages/agent-compose-mcp/node_modules/@modelcontextprotocol/server/dist/index.d.mts:808`：

```ts
declare function fromJsonSchema<T = unknown>(
  schema: JsonSchemaType,
  validator?: jsonSchemaValidator,
): StandardSchemaWithJSON<T, T>
```

`spike/spike-jsonschema.ts` 实测：

```ts
const standard = fromJsonSchema<{ message: string }>(UPSTREAM_INPUT_SCHEMA)
server.registerTool(
  'echo',
  { description: 'Echo back the given message.', inputSchema: standard },
  async ({ message }) => ({ content: [{ type: 'text', text: `echo:${message}` }] }),
)
```

```
inputSchema deep-equal to upstream = true
inputSchema keys = [ 'type', 'properties', 'required', 'additionalProperties', '$schema' ]
```

**两种透传方式都成立：**

| 方式                                                                        | 适用                                              | 备注                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| 低阶 `Server.setRequestHandler('tools/list', …)`                            | **proxy 的首选**                                  | 直接返回上游结果对象，零转换，类型摩擦最小（只需标注一次）           |
| 高层 `McpServer.registerTool(…, { inputSchema: fromJsonSchema(upstream) })` | 需要 SDK 的参数校验 / 自动 `structuredContent` 时 | 也能逐字保留，但 `fromJsonSchema` 需要一个 AJV validator（默认已带） |

> `fromJsonSchema` 的 **泛型参数 `T` 决定 tool callback 的 `args` 类型**。
> 不写泛型 → `args: unknown`，回调里拿不到类型。

---

## 7. 附带发现：2026-07-28 "modern" era（proxy 必须知道）

v2.4.0 引入了 **两个协议世代**：

|            | 2025 ("legacy")               | 2026-07-28 ("modern")                          |
| ---------- | ----------------------------- | ---------------------------------------------- |
| 握手       | `initialize`                  | `server/discover`                              |
| 传输       | 共享 session / stateless 都行 | **per-request**（每个请求带 `_meta` envelope） |
| session id | 可选                          | **不存在**（本来就是 per-request）             |

`createMcpHandler` **同时**服务两个世代：

- `legacy: 'stateless'`（**默认**）：2025 流量走 stateless fallback；2026 流量走 per-request。
- `legacy: 'reject'`：只服务 2026，2025 流量被拒。

实测 `legacy: 'reject'` 对 2025 客户端：

```
2025-era initialize status = 400
body = {"jsonrpc":"2.0","error":{"code":-32022",
  "message":"Unsupported protocol version: 2025-11-25",
  "data":{"supported":["2026-07-28"],"requested":"2025-11-25"}},"id":1}
```

实测 modern 客户端（`versionNegotiation: { mode: 'auto' }`）打 `createMcpHandler`：

```
isLegacyRequest = false
connect OK; sessionId = (none)
listTools = {"_meta":{"io.modelcontextprotocol/serverInfo":{...}},"ttlMs":0,
             "cacheScope":"private","tools":[...]}
```

> **对 proxy 的建议：用默认 `createMcpHandler`（不要设 `legacy: 'reject'`）**，
> 这样下游 agent 用哪种 client（2025 或 2026）都能接。

### `isLegacyRequest` / `classifyInboundRequest`

```ts
declare function isLegacyRequest(
  request: Request,
  parsedBody?: unknown,
  options?: IsLegacyRequestOptions,
): Promise<boolean>

declare function classifyInboundRequest(request: InboundHttpRequest): InboundClassificationOutcome
```

`isLegacyRequest` 是 **`createMcpHandler` 自己的分类逻辑导出**（不是重实现），
用于「modern 严格端点 + 自家 legacy 部署并存」的手搓路由。proxy 不需要它。

### `PerRequestHTTPServerTransport` 手搓要点

`spike/spike-transports.ts` A 段实测可跑，但需要自己：

1. `readRequestBody()` 读 body
2. `classifyInboundRequest()` 分类
3. 分类 `kind === 'reject'` → 自己答对应 HTTP 状态
4. `kind === 'modern'` → `classification: outcome.classification`
   （`kind === 'legacy'` → `{ era: 'legacy', revision: outcome.requestedVersion }`）
5. 自己检查 `Content-Type` 是否 `application/json`（否则 `415`）—— **SDK 不做这一步**
6. `transport.handleMessage(body, { request, authInfo })`

**结论：proxy 不要走这条路，用 `createMcpHandler`。**

---

## 8. 踩坑清单（汇总）

### 类型 / 编译期

| #   | 坑                                                                                           | 修法                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `setRequestHandler(ListToolsRequestSchema, …)` **不存在**                                    | 改成 `setRequestHandler('tools/list', …)`                                                  |
| 2   | 低阶 `Server` 注册 spec handler 报 `CAPABILITY_NOT_SUPPORTED`                                | 先 `server.registerCapabilities({ tools: {} })`（且要在 `connect()` 之前）                 |
| 3   | 3 参 `setRequestHandler(method, schemas, handler)` 用在 spec 方法上，运行时 `Invalid params` | 3 参**只用于自定义方法**                                                                   |
| 4   | `Tool['inputSchema']` 的 `type` 必须是字面量 `'object'`                                      | 显式标注返回类型                                                                           |
| 5   | `inputSchema.properties` 必须是 `JSONValue` map（`oneOf` 等 readonly 数组会报错）            | 显式标注 `{ [key: string]: JSONValue }`                                                    |
| 6   | `fromJsonSchema` 不写泛型 → callback `args: unknown`                                         | `fromJsonSchema<{ message: string }>(schema)`                                              |
| 7   | `onsessioninitialized` 回调里引用正在构造的 `transport` → TS7022/TS7023 循环推断             | 显式标注 `const transport: WebStandardStreamableHTTPServerTransport = ...`，回调参数标类型 |
| 8   | `Request` 构造器里手写 `content-length` 无效（forbidden header）                             | 用真实 HTTP 请求测该分支                                                                   |
| 9   | `node:http` → `Request` 用 stream body 时必须给 `duplex: 'half'`                             | 加上                                                                                       |

### 运行时

| #   | 坑                                                        | 说明                                                                                   |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 10  | `createMcpHandler` **不吃** `(req, res)`                  | 自己写 `toWebRequest` / `writeWebResponse` 桥（生产实现已改用 `toNodeHandler`）        |
| 11  | `requireBearerAuth` 返回 `AuthInfo \| Response`           | 必须 `instanceof Response` 判别                                                        |
| 12  | `AuthInfo.expiresAt` 缺失 → token 被拒                    | 必填                                                                                   |
| 13  | `Origin: null` 被拒（`invalid_origin_header`）            | 只放行明确列出的 hostname                                                              |
| 14  | `createMcpHandler` **不验证 token**                       | 必须自己挂 `requireBearerAuth` 并把 `authInfo` 显式传给 `fetch(request, { authInfo })` |
| 15  | `createMcpHandler` 默认 `responseMode: 'auto'` 会返回 SSE | 想纯 JSON 用 `responseMode: 'json'`（但会丢中途 notification）                         |
| 16  | `readRequestBody` 返回 **text**，不是二进制               | 自行 `JSON.parse`                                                                      |
| 17  | `StdioClientTransport` 不在主 barrel                      | 从 `@modelcontextprotocol/client/stdio` 导入                                           |
| 18  | stdio transport 的默认 env 不含 `HOME`                    | Linux 上显式传 `env`                                                                   |
| 19  | `Client` 默认 `versionNegotiation: 'legacy'`              | 需要 2026 era 才显式设 `{ mode: 'auto' }`                                              |
| 20  | `GET` / `DELETE` 在 stateless legacy 下是 `405`           | 正常，别当 bug                                                                         |
| 21  | `legacy: 'reject'` 会把 2025 客户端拒成 `400 / -32022`    | proxy 别用这个选项                                                                     |

---

## 9. 对 proxy 实现的直接建议（基于以上实测）

1. **下游（server 侧）**：用 `createMcpHandler(factory)`，**默认选项**，不设 `legacy: 'reject'`。
   factory 里用**低阶 `Server`**（不是 `McpServer`）以透传上游 schema：
   ```ts
   const server = new Server({ name: 'agent-compose-mcp', version: '0.0.1' })
   server.registerCapabilities({ tools: {} })
   server.setRequestHandler('tools/list', async () => ({ tools: await listUpstreamTools() }))
   server.setRequestHandler('tools/call', async (req) => await callUpstreamTool(req.params))
   ```
   （每次请求新建 instance 是 `createMcpHandler` 的设计 —— factory 本来就是 per-request 的。）
2. **node:http 桥**：用 `spike/node-http-bridge.ts`，或引入 `@modelcontextprotocol/node` 的
   `toNodeHandler`（**已安装并已在用**）。
3. **上游（client 侧）**：`Client` + `StdioClientTransport`（stdio 上游）或
   `Client` + `StreamableHTTPClientTransport`（HTTP 上游）。
   `client.listTools()` / `client.callTool({ name, arguments })`。
4. **鉴权**：`requireBearerAuth` 门禁 → `handler.fetch(request, { authInfo })`。
   `AuthInfo.expiresAt` 必填。
5. **stateless 可行**：不需要 session id，普通客户端全流程可跑通。

---

## 附录 A：spike 文件清单

| 文件                             | 验证点                                                                                     | 运行结果                              |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| `spike/minimal-stdio-server.ts`  | 手写 JSON-RPC over stdio 的最小 MCP server（**无 npx / 无网络**）                          | 作为 `spike-client.ts` 的被测端，PASS |
| `spike/node-http-bridge.ts`      | `node:http` ↔ Web `Request`/`Response` 桥                                                  | 被 5 个脚本复用，PASS                 |
| `spike/spike-client.ts`          | 验证点 3：`Client` + `StdioClientTransport` 的真实方法名与参数形状                         | PASS                                  |
| `spike/spike-server.ts`          | 验证点 1 + 2：`createMcpHandler` / stateless / stateful 三种 wiring，`mcp-session-id` 观察 | PASS                                  |
| `spike/spike-transports.ts`      | `PerRequestHTTPServerTransport` 手搓、stateful session 校验、modern era client             | PASS                                  |
| `spike/spike-auth.ts`            | 验证点 4：bearer auth 三个 API + origin/host 校验                                          | PASS                                  |
| `spike/spike-http-wiring.ts`     | 验证点 4/5：auth gate 挂 `createMcpHandler`、`maxRequestBodySize` → 413                    | PASS                                  |
| `spike/spike-lowlevel.ts`        | 验证点 6：低阶 `Server` 透传原始 JSON Schema；`McpServer.registerTool` 存在性              | PASS                                  |
| `spike/spike-jsonschema.ts`      | `fromJsonSchema` + `registerTool` 透传；stateful session 不匹配 → 404                      | PASS                                  |
| `spike/spike-details.ts`         | `tools/call` result 额外字段保留；3 参重载边界；`legacy: 'reject'`；`handler.notify`/`bus` | PASS                                  |
| `spike/spike-upstream-client.ts` | 验证点 3 扩展：`StreamableHTTPClientTransport` 连 stateful / stateless 上游                | PASS                                  |
| `spike/run-all.ts`               | 一键跑全部 spike 脚本并汇总 pass/fail                                                      | 9/9 PASS                              |
| `spike/tsconfig.json`            | spike 目录的类型检查配置                                                                   | `tsc --noEmit` 0 errors               |

**全部脚本 `node --experimental-strip-types` 运行 exit 0。**

## 附录 B：版本常量（实测值）

```ts
LATEST_PROTOCOL_VERSION = '2025-11-25'
SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']
DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26'
DEFAULT_MAX_REQUEST_BODY_SIZE = 4194304 // 4 MiB
localhostAllowedHostnames() = ['localhost', '127.0.0.1', '[::1]']
localhostAllowedOrigins() = ['localhost', '127.0.0.1', '[::1]']
```
