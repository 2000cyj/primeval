/**
 * Spike: the auth / DNS-rebinding / body-reading middleware helpers.
 *
 * Covers:
 *  - requireBearerAuth(options) -> (request) => Promise<AuthInfo | Response>
 *  - verifyBearerToken(header, options) -> Promise<AuthInfo>  (throws OAuthError)
 *  - bearerAuthChallengeResponse(error, options?) -> Response
 *  - validateOriginHeader(origin, allowedHostnames)
 *  - localhostAllowedOrigins() / localhostAllowedHostnames()
 *  - validateHostHeader(host, allowedHostnames)
 *  - readRequestBody(request, maxBytes?) and DEFAULT_MAX_REQUEST_BODY_SIZE
 *
 * Run: node --experimental-strip-types spike/spike-auth.ts
 */
import { createServer } from 'node:http'
import {
  OAuthError,
  OAuthErrorCode,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  bearerAuthChallengeResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  readRequestBody,
  requireBearerAuth,
  validateHostHeader,
  validateOriginHeader,
  verifyBearerToken,
} from '@modelcontextprotocol/server'

const TOKEN = 'good-token'

const verifier = {
  async verifyAccessToken(token: string) {
    if (token !== TOKEN) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'unknown token')
    }
    return {
      token,
      clientId: 'client-1',
      scopes: ['mcp', 'read'],
      // expiresAt is REQUIRED: the SDK rejects tokens without it.
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource: new URL('http://127.0.0.1:7801/mcp'),
    }
  },
}

async function main(): Promise<void> {
  console.log('DEFAULT_MAX_REQUEST_BODY_SIZE =', DEFAULT_MAX_REQUEST_BODY_SIZE)
  console.log('localhostAllowedHostnames()   =', localhostAllowedHostnames())
  console.log('localhostAllowedOrigins()     =', localhostAllowedOrigins())

  // ---- verifyBearerToken ----
  console.log('\n--- verifyBearerToken ---')
  const authInfo = await verifyBearerToken(`Bearer ${TOKEN}`, { verifier })
  console.log('ok  =', JSON.stringify(authInfo))

  try {
    await verifyBearerToken('Bearer nope', { verifier })
  } catch (error) {
    console.log(
      'bad token throws =',
      (error as Error).name,
      (error as Error).message,
      'code=',
      (error as OAuthError).code,
    )
  }

  try {
    await verifyBearerToken(`Bearer ${TOKEN}`, { verifier, requiredScopes: ['admin'] })
  } catch (error) {
    console.log('missing scope throws code =', (error as OAuthError).code)
  }

  // expectedResource mismatch
  try {
    await verifyBearerToken(`Bearer ${TOKEN}`, {
      verifier,
      expectedResource: new URL('http://example.com/other'),
    })
  } catch (error) {
    console.log('resource mismatch throws code =', (error as OAuthError).code)
  }

  // ---- bearerAuthChallengeResponse ----
  console.log('\n--- bearerAuthChallengeResponse ---')
  const challenge = bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, 'nope'))
  console.log('status =', challenge.status)
  console.log('www-authenticate =', challenge.headers.get('www-authenticate'))
  console.log('body =', await challenge.text())

  const scopeChallenge = bearerAuthChallengeResponse(
    new OAuthError(OAuthErrorCode.InsufficientScope, 'need more'),
  )
  console.log(
    'scope status =',
    scopeChallenge.status,
    '| www-authenticate =',
    scopeChallenge.headers.get('www-authenticate'),
  )

  // ---- requireBearerAuth (the fetch gate) ----
  console.log('\n--- requireBearerAuth ---')
  const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] })

  const good = await gate(
    new Request('http://127.0.0.1/mcp', { headers: { authorization: `Bearer ${TOKEN}` } }),
  )
  console.log(
    'good request -> isResponse =',
    good instanceof Response,
    '| authInfo =',
    good instanceof Response ? '' : JSON.stringify(good),
  )

  const bad = await gate(
    new Request('http://127.0.0.1/mcp', { headers: { authorization: 'Bearer wrong' } }),
  )
  console.log('bad request  -> isResponse =', bad instanceof Response)
  if (bad instanceof Response) {
    console.log(
      '  status =',
      bad.status,
      '| www-authenticate =',
      bad.headers.get('www-authenticate'),
    )
  }

  const missing = await gate(new Request('http://127.0.0.1/mcp'))
  console.log('no header   -> isResponse =', missing instanceof Response)
  if (missing instanceof Response) {
    console.log(
      '  status =',
      missing.status,
      '| www-authenticate =',
      missing.headers.get('www-authenticate'),
    )
  }

  // ---- validateOriginHeader ----
  console.log('\n--- validateOriginHeader ---')
  console.log(
    'no origin        =',
    JSON.stringify(validateOriginHeader(null, localhostAllowedOrigins())),
  )
  console.log(
    'http://localhost =',
    JSON.stringify(validateOriginHeader('http://localhost:3000', localhostAllowedOrigins())),
  )
  console.log(
    'http://127.0.0.1 =',
    JSON.stringify(validateOriginHeader('http://127.0.0.1:7801', localhostAllowedOrigins())),
  )
  console.log(
    'https://evil.com =',
    JSON.stringify(validateOriginHeader('https://evil.com', localhostAllowedOrigins())),
  )
  console.log(
    'null origin      =',
    JSON.stringify(validateOriginHeader('null', localhostAllowedOrigins())),
  )

  // ---- validateHostHeader ----
  console.log('\n--- validateHostHeader ---')
  console.log(
    'localhost:3000  =',
    JSON.stringify(validateHostHeader('localhost:3000', localhostAllowedHostnames())),
  )
  console.log(
    '127.0.0.1:7801  =',
    JSON.stringify(validateHostHeader('127.0.0.1:7801', localhostAllowedHostnames())),
  )
  console.log(
    'evil.com        =',
    JSON.stringify(validateHostHeader('evil.com', localhostAllowedHostnames())),
  )
  console.log(
    'missing         =',
    JSON.stringify(validateHostHeader(undefined, localhostAllowedHostnames())),
  )

  // ---- readRequestBody ----
  console.log('\n--- readRequestBody ---')
  const small = await readRequestBody(
    new Request('http://127.0.0.1/mcp', { method: 'POST', body: '{"a":1}' }),
  )
  console.log('small =', JSON.stringify(small))

  const big = await readRequestBody(
    new Request('http://127.0.0.1/mcp', { method: 'POST', body: 'x'.repeat(100) }),
    10,
  )
  console.log('over limit =', JSON.stringify(big))

  const declared = await readRequestBody(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      body: 'y'.repeat(50),
      headers: { 'content-length': '5000' },
    }),
  )
  console.log('declared too large (Request strips content-length) =', JSON.stringify(declared))

  // The same check against a REAL HTTP request, where `content-length` is
  // actually present on the Request object -> the declared-size short
  // circuit fires.
  await new Promise<void>((resolve) => {
    const server = createServer(async (req, res) => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value)
      }
      const request = new Request('http://127.0.0.1:17811/', { method: 'POST', headers })
      const body = await readRequestBody(request, 10)
      console.log(
        `real HTTP request (content-length=${req.headers['content-length']}) =`,
        JSON.stringify(body),
      )
      res.end('ok')
    })
    server.listen(17811, '127.0.0.1', () => {
      void fetch('http://127.0.0.1:17811/', { method: 'POST', body: 'x'.repeat(100) }).then(() => {
        server.close(() => resolve())
      })
    })
  })
}

main().catch((error) => {
  console.error('[auth] FAILED:', error)
  process.exitCode = 1
})
