# OAuth 授权实测清单

> 生成时间：2026-11-11
> 方法：直接向每个服务的 MCP 端点发 `initialize`，读 401 的 `www-authenticate` 挑战头
> 拿到授权服务器地址，再对授权服务器发动态客户端注册，看**是否真的注册成功**。

## 结论

- **9 个服务的标准 OAuth 流程能走通**（动态注册成功 → 浏览器授权 → 拿令牌）
- **Figma 走不通**（动态注册 403，要求预先在 Figma 后台注册 OAuth 应用）→ 只能用 PAT
- **Stripe / GitHub 没有注册端点** → 会降级成自选 client_id，能人工授权但不一定被接受

## 能走通浏览器授权的服务（推荐手工测试用这些）

| 服务   | 端点                           | scope                   | 备注                 |
| ------ | ------------------------------ | ----------------------- | -------------------- |
| Notion | `https://mcp.notion.com/mcp`   | `default`               | 登录 Notion 账号即可 |
| Linear | `https://mcp.linear.app/mcp`   | `read write`            |                      |
| Sentry | `https://mcp.sentry.dev/mcp`   | —                       |                      |
| Vercel | `https://mcp.vercel.com`       | —                       |                      |
| PayPal | `https://mcp.paypal.com/mcp`   | —                       |                      |
| Asana  | `https://mcp.asana.com/sse`    | —                       | 注意是 SSE 端点      |
| Square | `https://mcp.squareup.com/mcp` | —                       |                      |
| Canva  | `https://mcp.canva.com/mcp`    | —                       |                      |
| Tavily | `https://mcp.tavily.com/mcp/`  | `openid offline_access` |                      |

## 走不通的

| 服务   | 端点                                 | 原因                                            | 怎么办                                       |
| ------ | ------------------------------------ | ----------------------------------------------- | -------------------------------------------- |
| Figma  | `https://mcp.figma.com/mcp`          | 动态注册 403 Forbidden：要求预先注册 OAuth 应用 | 用 PAT（固定令牌）。Figma 官方也是这么推荐的 |
| Stripe | `https://mcp.stripe.com`             | 授权服务器没有 `registration_endpoint`          | 降级自选 client_id 或用 API key              |
| GitHub | `https://api.githubcopilot.com/mcp/` | 授权服务器没有 `registration_endpoint`          | 用 GitHub PAT（固定令牌）                    |

## 手工测试步骤

1. MCP 页 →「新增 server」(或「从目录添加」直接选官方目录里的 server)
2. 名称随便填，id 填小写（如 `notion`）
3. 传输方式：**http**
4. url：填上表里的端点
5. 认证方式：**OAuth 授权**
6. 「令牌」留空（走浏览器授权）
7. 保存 → 点「测试」
   - 会拉起浏览器 → 登录并同意 → 回到应用会提示连接成功
   - 如果报「动态客户端注册被拒绝…请改用固定令牌」→ 这个服务不支持自动授权，改用 PAT

## 为什么 Figma 不行

Figma 的授权服务器元数据里有注册端点：

```json
"registration_endpoint": "https://api.figma.com/v1/oauth/mcp/register"
```

但 POST 过去返回 `Forbidden` —— 它要求**预先在 Figma 后台注册一个 OAuth 应用**，
拿不到合法的 client_id，授权端点就会报：

```
OAuth app with client id agent-compose-xxx doesn't exist
```

这是 Figma 的策略，不是工具的问题。Figma 官方对 MCP 场景推荐的也是 PAT。
