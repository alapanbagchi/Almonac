import { readJsonBody } from '../../shared/http-body'

/** Identity-provider failures that are safe to map to an API code. */
export class OidcUnavailableError extends Error {
  constructor() {
    super('identity provider is unavailable')
    this.name = 'OidcUnavailableError'
  }
}

export class OidcRejectedError extends Error {
  constructor() {
    super('identity provider rejected the request')
    this.name = 'OidcRejectedError'
  }
}

/** Minimal fetch surface so tests can supply a deterministic transport. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface TokenExchangeInput {
  readonly tokenEndpoint: string
  readonly clientId: string
  readonly clientSecret: string
  readonly code: string
  readonly codeVerifier: string
  readonly redirectUri: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
}

export interface TokenExchangeResult {
  readonly idToken: string
}

const TOKEN_TIMEOUT_MS = 10_000
const MAX_TOKEN_BODY_BYTES = 256 * 1_024

/**
 * Exchange an authorization code with the confidential client secret. The
 * provider response is untrusted: it is bounded, parsed, and never logged.
 */
export async function exchangeAuthorizationCode(
  input: TokenExchangeInput,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
  })
  const authorization = Buffer.from(
    `${input.clientId}:${input.clientSecret}`,
    'utf8',
  ).toString('base64')

  let response: Response
  try {
    response = await (input.fetch ?? fetch)(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${authorization}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(input.timeoutMs ?? TOKEN_TIMEOUT_MS),
    })
  } catch {
    throw new OidcUnavailableError()
  }

  if (response.status >= 500) throw new OidcUnavailableError()
  if (!response.ok) throw new OidcRejectedError()

  let payload: unknown
  try {
    payload = await readJsonBody(response, MAX_TOKEN_BODY_BYTES)
  } catch {
    throw new OidcUnavailableError()
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new OidcUnavailableError()
  }
  const idToken = (payload as Record<string, unknown>).id_token
  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new OidcUnavailableError()
  }

  return { idToken }
}
