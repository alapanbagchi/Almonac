import { createHash, randomBytes } from 'node:crypto'

export interface PkcePair {
  readonly verifier: string
  readonly challenge: string
}

export interface LoginSecrets extends PkcePair {
  readonly state: string
  readonly nonce: string
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
