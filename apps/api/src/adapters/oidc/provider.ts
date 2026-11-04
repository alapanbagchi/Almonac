import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet } from 'jose'
import { readJsonBody } from '../../shared/http-body'
import {
  OidcUnavailableError,
  exchangeAuthorizationCode,
  type FetchLike,
} from './token-client'
import {
  createIdTokenVerifier,
  type IdTokenVerifier,
  type VerifiedIdentity,
} from './verifier'

export interface OidcMetadata {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly jwksUri: string
  readonly endSessionEndpoint: string | null
}

export interface OidcDiscovery {
  metadata(): Promise<OidcMetadata>
}

export interface OidcDiscoveryOptions {
  readonly issuer: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  readonly cacheTtlMs?: number
  readonly clock?: () => Date
}

export interface PkcePair {
  readonly verifier: string
  readonly challenge: string
}

export interface LoginSecrets extends PkcePair {
  readonly state: string
  readonly nonce: string
}

export interface AuthorizationUrlInput {
  readonly authorizationEndpoint: string
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly nonce: string
  readonly challenge: string
  readonly prompt?: string
  readonly maxAgeSeconds?: number
}

export interface OidcProvider {
  authorizationUrl(
    input: Omit<AuthorizationUrlInput, 'authorizationEndpoint' | 'clientId' | 'redirectUri'>,
  ): Promise<string>
  exchangeCode(code: string, codeVerifier: string): Promise<string>
  verifyIdToken(idToken: string, nonceHash: Buffer): Promise<VerifiedIdentity>
  endSessionUrl(idTokenHint: string): Promise<string | null>
}

export interface OidcProviderOptions {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly postLogoutUri: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  readonly clock?: () => Date
}

const DISCOVERY_TIMEOUT_MS = 5_000
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_DISCOVERY_BODY_BYTES = 256 * 1_024

/**
 * Fetch and cache OpenID Connect discovery metadata. The configured issuer and
 * the returned issuer must match exactly; a redirect to another issuer is
 * never accepted.
 */
export function createOidcDiscovery(options: OidcDiscoveryOptions): OidcDiscovery {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS
  const cacheTtlMs = options.cacheTtlMs ?? DISCOVERY_CACHE_TTL_MS
  const clock = options.clock ?? (() => new Date())
  const issuer = options.issuer.replace(/\/+$/, '')
  const requireHttps = issuer.startsWith('https:')
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`

  let cached: { readonly metadata: OidcMetadata; readonly freshUntil: number } | null =
    null
  let inFlight: Promise<OidcMetadata> | null = null

  return {
    async metadata(): Promise<OidcMetadata> {
      if (cached !== null && cached.freshUntil > clock().getTime()) {
        return cached.metadata
      }
      inFlight ??= loadMetadata().finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }

  async function loadMetadata(): Promise<OidcMetadata> {
    let response: Response
    try {
      response = await fetchImpl(discoveryUrl, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new OidcUnavailableError()
    }

    if (!response.ok) throw new OidcUnavailableError()

    let body: unknown
    try {
      body = await readJsonBody(response, MAX_DISCOVERY_BODY_BYTES)
    } catch {
      throw new OidcUnavailableError()
    }

    const metadata = parseMetadata(body, requireHttps)
    if (metadata.issuer !== issuer) throw new OidcUnavailableError()

    cached = {
      metadata,
      freshUntil: clock().getTime() + cacheTtlMs,
    }
    return metadata
  }
}

/**
 * Compose discovery, the token endpoint and ID-token verification. JWKS is
 * fetched lazily and cached by jose; no token or key material is logged.
 */
export function createOidcProvider(options: OidcProviderOptions): OidcProvider {
  const discovery: OidcDiscovery = createOidcDiscovery({
    issuer: options.issuer,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  })
  let verifier: { readonly keySetUri: string; readonly value: IdTokenVerifier } | null =
    null

  return {
    async authorizationUrl(input) {
      const metadata = await discovery.metadata()
      return buildAuthorizationUrl({
        ...input,
        authorizationEndpoint: metadata.authorizationEndpoint,
        clientId: options.clientId,
        redirectUri: options.redirectUri,
      })
    },

    async exchangeCode(code, codeVerifier) {
      const metadata = await discovery.metadata()
      const result = await exchangeAuthorizationCode({
        tokenEndpoint: metadata.tokenEndpoint,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        code,
        codeVerifier,
        redirectUri: options.redirectUri,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      })
      return result.idToken
    },

    async verifyIdToken(idToken, nonceHash) {
      // The key set is cached until discovery starts advertising another JWKS.
      const metadata = await discovery.metadata()
      if (verifier?.keySetUri !== metadata.jwksUri) {
        verifier = {
          keySetUri: metadata.jwksUri,
          value: createIdTokenVerifier({
            issuer: metadata.issuer,
            clientId: options.clientId,
            keySet: createRemoteJWKSet(new URL(metadata.jwksUri)),
            ...(options.clock === undefined ? {} : { now: options.clock }),
          }),
        }
      }
      return verifier.value.verify(idToken, nonceHash)
    },

    async endSessionUrl(idTokenHint) {
      const metadata = await discovery.metadata()
      if (metadata.endSessionEndpoint === null) return null
      const url = new URL(metadata.endSessionEndpoint)
      url.searchParams.set('id_token_hint', idTokenHint)
      url.searchParams.set('post_logout_redirect_uri', options.postLogoutUri)
      url.searchParams.set('client_id', options.clientId)
      return url.toString()
    },
  }
}

export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: challengeFor(verifier) }
}

/** RFC 7636 S256: base64url(SHA-256(ASCII(verifier))). */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function createLoginSecrets(): LoginSecrets {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    ...createPkce(),
  }
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.prompt !== undefined) url.searchParams.set('prompt', input.prompt)
  if (input.maxAgeSeconds !== undefined) {
    url.searchParams.set('max_age', String(input.maxAgeSeconds))
  }
  return url.toString()
}

function parseMetadata(value: unknown, requireHttps: boolean): OidcMetadata {
  const row = record(value)
  const issuer = text(row, 'issuer')
  const authorizationEndpoint = text(row, 'authorization_endpoint')
  const tokenEndpoint = text(row, 'token_endpoint')
  const jwksUri = text(row, 'jwks_uri')
  const endSessionEndpoint =
    row.end_session_endpoint === undefined
      ? null
      : text(row, 'end_session_endpoint')

  for (const endpoint of [
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    endSessionEndpoint,
  ]) {
    if (endpoint !== null) assertEndpoint(endpoint, requireHttps)
  }

  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    endSessionEndpoint,
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OidcUnavailableError()
  }
  return value as Record<string, unknown>
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new OidcUnavailableError()
  }
  return value
}

function assertEndpoint(value: string, requireHttps: boolean): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OidcUnavailableError()
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new OidcUnavailableError()
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new OidcUnavailableError()
  }
}
