import { SignJWT, importPKCS8 } from 'jose'

export interface ServiceUserKey {
  readonly issuer: string
  readonly userId: string
  readonly keyId: string
  readonly privateKeyPem: string
}

export interface AccessTokenProvider {
  token(): Promise<string>
}

/**
 * Zitadel service-user token: a short-lived RS256 JWT exchanged for an
 * access token. The private key never leaves this module and is never logged.
 */
export function createServiceUserTokenProvider(
  key: ServiceUserKey,
  fetchImpl: typeof fetch = fetch,
): AccessTokenProvider {
  let cached: { value: string; expiresAt: number } | null = null

  return {
    async token() {
      const now = Math.floor(Date.now() / 1000)
      if (cached !== null && cached.expiresAt > now + 30) return cached.value

      const privateKey = await importPKCS8(key.privateKeyPem, 'RS256')
      const assertion = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: key.keyId })
        .setIssuer(key.userId)
        .setSubject(key.userId)
        .setAudience(key.issuer)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey)

      const response = await fetchImpl(new URL('/oauth/v2/token', key.issuer), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
          scope: 'openid urn:zitadel:iam:org:project:id:zitadel:aud',
        }),
        redirect: 'error',
      })

      if (!response.ok) {
        throw new ZitadelUnavailableError('service token request failed')
      }

      const body = readRecord(await readJson(response))
      const value = body.access_token
      const expiresIn = body.expires_in
      if (typeof value !== 'string' || value.length === 0 || typeof expiresIn !== 'number') {
        throw new ZitadelUnavailableError('service token response is malformed')
      }

      cached = { value, expiresAt: now + Math.max(30, expiresIn) }
      return value
    },
  }
}

export type ZitadelFetch = typeof fetch

export class ZitadelConflictError extends Error {
  constructor() {
    super('Zitadel reported a conflict')
    this.name = 'ZitadelConflictError'
  }
}

export class ZitadelUnavailableError extends Error {
  constructor(message = 'Zitadel is unavailable') {
    super(message)
    this.name = 'ZitadelUnavailableError'
  }
}

export class ZitadelRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super('Zitadel rejected the request')
    this.name = 'ZitadelRejectedError'
  }
}

export class ZitadelManagementClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: AccessTokenProvider,
    private readonly fetchImpl: ZitadelFetch = fetch,
  ) {}

  async createOrganisation(name: string): Promise<string> {
    const body = await this.request('POST', '/management/v1/orgs', { name })
    const id = readRecord(body).id
    if (typeof id !== 'string' || id.length === 0) {
      throw new ZitadelUnavailableError('organisation response has no id')
    }
    return id
  }

  async addOrganisationDomain(organisationId: string, domain: string): Promise<void> {
    await this.request(
      'POST',
      '/management/v1/orgs/me/domains',
      { domain },
      organisationId,
    )
  }

  async verifyOrganisationDomain(organisationId: string, domain: string): Promise<void> {
    await this.request(
      'POST',
      `/management/v1/orgs/me/domains/${encodeURIComponent(domain)}/validation/_validate`,
      {},
      organisationId,
    )
  }

  async createHumanUser(
    organisationId: string,
    input: { email: string; displayName: string },
  ): Promise<string> {
    const parts = input.displayName.trim().split(/\s+/)
    const firstName = parts[0] ?? input.email
    const lastName = parts.slice(1).join(' ') || firstName
    const body = await this.request(
      'POST',
      '/management/v1/users/human/_import',
      {
        userName: input.email,
        profile: { firstName, lastName, displayName: input.displayName },
        email: { email: input.email, isEmailVerified: false },
      },
      organisationId,
    )
    const userId = readRecord(body).userId
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new ZitadelUnavailableError('user response has no id')
    }
    return userId
  }

  async resendInitialization(organisationId: string, userId: string): Promise<void> {
    await this.request(
      'POST',
      `/management/v1/users/${encodeURIComponent(userId)}/_resend_initialization`,
      {},
      organisationId,
    )
  }

  async deactivateUser(organisationId: string, userId: string): Promise<void> {
    await this.request(
      'POST',
      `/management/v1/users/${encodeURIComponent(userId)}/_deactivate`,
      {},
      organisationId,
    )
  }

  private async request(
    method: 'POST',
    path: string,
    payload: unknown,
    organisationId?: string,
  ): Promise<unknown> {
    const token = await this.tokens.token()
    let response: Response
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(organisationId === undefined
            ? {}
            : { 'x-zitadel-orgid': organisationId }),
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ZitadelUnavailableError()
    }

    if (response.status === 409) throw new ZitadelConflictError()
    if (response.status === 429 || response.status >= 500) {
      throw new ZitadelUnavailableError()
    }
    if (!response.ok) {
      const body = await readJson(response).catch(() => null)
      const code =
        body !== null && typeof body === 'object' && 'message' in body
          ? String((body as { message: unknown }).message).slice(0, 100)
          : null
      throw new ZitadelRejectedError(response.status, code)
    }

    return readJson(response)
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return {}
  if (text.length > 64 * 1024) throw new ZitadelUnavailableError('response is too large')
  return JSON.parse(text) as unknown
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ZitadelUnavailableError('response is not an object')
  }
  return value as Record<string, unknown>
}
