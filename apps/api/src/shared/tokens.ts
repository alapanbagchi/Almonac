import { createHash, randomBytes } from 'node:crypto'

/** A session token is 256 bits of randomness, base64url encoded without padding. */
export const SESSION_TOKEN_BYTES = 32
const SESSION_TOKEN_LENGTH = 43
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface MintedToken {
  readonly token: string
  readonly tokenHash: Buffer
}

/**
 * Mint an opaque token and the SHA-256 hash that is stored in the database.
 * The token itself is returned once and never persisted.
 */
export function mintToken(): MintedToken {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

/**
 * Hash a token for lookup. The database stores only this value, so a database
 * reader cannot replay a session.
 */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * Check the shape before hashing untrusted input. A malformed bearer token is
 * rejected without a database lookup.
 */
export function isSessionToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === SESSION_TOKEN_LENGTH &&
    SESSION_TOKEN_PATTERN.test(value)
  )
}
