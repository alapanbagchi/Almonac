import { readJsonBody } from '../shared/http-body'
import { OidcUnavailableError } from './errors'
import type { FetchLike } from './fetch'

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