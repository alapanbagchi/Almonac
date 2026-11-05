import { SignJWT, importPKCS8 } from 'jose'
import { readJsonBody } from '../../shared/http-body'

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
  const privateKey = importPKCS8(key.privateKeyPem, 'RS256')

  return {
    async token() {
      const now = Math.floor(Date.now() / 1000)
      if (cached !== null && cached.expiresAt > now + 30) return cached.value

      const assertion = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: key.keyId })
        .setIssuer(key.userId)
        .setSubject(key.userId)
        .setAudience(key.issuer)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(await privateKey)

      let response: Response
      try {
        response = await fetchImpl(new URL('/oauth/v2/token', key.issuer), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
            scope: 'openid urn:zitadel:iam:org:project:id:zitadel:aud',
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        throw new ZitadelUnavailableError()
      }

      if (!response.ok) {
        throw new ZitadelUnavailableError('service token request failed')
      }

      const body = readRecord(await readProviderJson(response))
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

  /**
   * Create a user whose email was verified by Almonac. The password arrives as
   * a bcrypt hash, so the plaintext never reaches the provider. The v2 API is
   * used because the management import always creates an unverified address.
   */
  async createVerifiedHumanUser(input: {
    email: string
    displayName: string
    passwordHash: string
  }): Promise<string> {
    const names = splitName(input)
    const body = await this.request('POST', '/v2/users/human', {
      username: input.email,
      profile: { ...names, displayName: input.displayName },
      email: { email: input.email, isVerified: true },
      hashedPassword: { hash: input.passwordHash },
    })
    return readUserId(body)
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
      const body = await readProviderJson(response).catch(() => null)
      const code =
        body !== null && typeof body === 'object' && 'message' in body
          ? String(body.message).slice(0, 100)
          : null
      throw new ZitadelRejectedError(response.status, code)
    }

    return readProviderJson(response)
  }
}

const MAX_RESPONSE_BYTES = 64 * 1024

async function readProviderJson(response: Response): Promise<unknown> {
  try {
    return await readJsonBody(response, MAX_RESPONSE_BYTES)
  } catch {
    throw new ZitadelUnavailableError('response body is unavailable')
  }
}

/**
 * Zitadel wants a given and a family name. A single word becomes both, and an
 * empty display name falls back to the address rather than a blank profile.
 */
function splitName(input: { email: string; displayName: string }): {
  givenName: string
  familyName: string
} {
  const [first = input.email, ...rest] = input.displayName.trim().split(/\s+/)
  return { givenName: first, familyName: rest.join(' ') || first }
}

/** The user id both create calls return; a provider without one is unusable. */
function readUserId(body: unknown): string {
  const userId = readRecord(body).userId
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ZitadelUnavailableError('user response has no id')
  }
  return userId
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ZitadelUnavailableError('response is not an object')
  }
  return value as Record<string, unknown>
}
