import type { AccessTokenProvider } from '../adapters/zitadel/client'
import {
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../adapters/zitadel/client'

const AUTH_REQUEST_PATTERN = /^V2_[A-Za-z0-9_-]{1,64}$/
const MAX_RESPONSE_BYTES = 32 * 1024
const DEFAULT_TIMEOUT_MS = 10_000

/** The provider requires a second factor that this password flow cannot supply. */
export class MfaRequiredError extends Error {
  constructor() {
    super('the identity provider requires multi-factor authentication')
    this.name = 'MfaRequiredError'
  }
}

/** The provider answered, but not with a usable authorization request. */
export class InvalidAuthRequestError extends Error {
  constructor() {
    super('the provider returned an invalid authorization request')
    this.name = 'InvalidAuthRequestError'
  }
}

export interface SessionCredentials {
  readonly sessionId: string
  readonly sessionToken: string
}

/**
 * Headless login against Zitadel: start the authorization request, verify the
 * password with the session API, then finish the request and return the
 * callback URL. The password is sent only to the provider and never stored,
 * logged or echoed.
 */
export interface LoginClient {
  start(authorizationUrl: string): Promise<string>
  signIn(loginName: string, password: string): Promise<SessionCredentials>
  complete(authRequestId: string, session: SessionCredentials): Promise<string>
}

export interface LoginClientOptions {
  readonly issuer: string
  readonly loginClientUserId: string
  readonly redirectUri: string
  readonly tokens: AccessTokenProvider
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

export class ZitadelLoginClient implements LoginClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly issuerOrigin: string

  constructor(private readonly options: LoginClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.issuerOrigin = new URL(options.issuer).origin
  }

  /** Turn the authorization URL into a provider auth-request ID. */
  async start(authorizationUrl: string): Promise<string> {
    const response = await this.send(authorizationUrl, {
      method: 'GET',
      headers: {
        accept: 'text/html',
        'x-zitadel-login-client': this.options.loginClientUserId,
      },
      redirect: 'manual',
    })

    if (response.status < 300 || response.status >= 400) {
      throw new InvalidAuthRequestError()
    }
    const location = response.headers.get('location')
    if (location === null || location.length === 0) {
      throw new InvalidAuthRequestError()
    }

    const url = new URL(location, this.options.issuer)
    if (url.origin !== this.issuerOrigin) throw new InvalidAuthRequestError()
    const authRequest = url.searchParams.get('authRequest') ?? url.searchParams.get('requestId')
    if (authRequest === null || !AUTH_REQUEST_PATTERN.test(authRequest)) {
      throw new InvalidAuthRequestError()
    }
    return authRequest
  }

  /** Verify the password. A non-empty challenge list means MFA is required. */
  async signIn(loginName: string, password: string): Promise<SessionCredentials> {
    const response = await this.request('/v2/sessions', {
      checks: { user: { loginName }, password: { password } },
    })
    const body = await this.readBody(response)
    const challenges = body.challenges
    if (Array.isArray(challenges) && challenges.length > 0) {
      throw new MfaRequiredError()
    }

    const sessionId = body.sessionId
    const sessionToken = body.sessionToken
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new ZitadelUnavailableError('session response has no id')
    }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      throw new ZitadelUnavailableError('session response has no token')
    }
    return { sessionId, sessionToken }
  }

  /** Finish the auth request and return the code callback URL. */
  async complete(authRequestId: string, session: SessionCredentials): Promise<string> {
    const response = await this.request(
      '/v2/oidc/auth_requests/' + encodeURIComponent(authRequestId),
      { session: { sessionId: session.sessionId, sessionToken: session.sessionToken } },
    )
    const body = await this.readBody(response)
    const callbackUrl = body.callbackUrl
    if (typeof callbackUrl !== 'string' || callbackUrl.length > 2_048) {
      throw new ZitadelUnavailableError('callback response is malformed')
    }

    const callback = new URL(callbackUrl)
    const expected = new URL(this.options.redirectUri)
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
      throw new InvalidAuthRequestError()
    }
    if (!callback.searchParams.has('code') || !callback.searchParams.has('state')) {
      throw new InvalidAuthRequestError()
    }
    return callbackUrl
  }

  private async request(path: string, payload: unknown): Promise<Response> {
    const token = await this.options.tokens.token()
    const response = await this.send(new URL(path, this.options.issuer), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'error',
    })

    if (response.status === 429 || response.status >= 500) {
      throw new ZitadelUnavailableError()
    }
    if (!response.ok) {
      throw new ZitadelRejectedError(response.status, null)
    }
    return response
  }

  private async send(input: string | URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new ZitadelUnavailableError()
    }
  }

  private async readBody(response: Response): Promise<Record<string, unknown>> {
    let text: string
    try {
      text = await response.text()
    } catch {
      throw new ZitadelUnavailableError()
    }
    if (text.length === 0 || text.length > MAX_RESPONSE_BYTES) {
      throw new ZitadelUnavailableError('response is malformed')
    }

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new ZitadelUnavailableError('response is malformed')
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ZitadelUnavailableError('response is malformed')
    }
    return value as Record<string, unknown>
  }
}
