import { jwtVerify, type JWTVerifyGetKey } from 'jose'
import { hashToken } from '../shared/tokens'
import { InvalidIdTokenError } from './errors'

export interface VerifiedIdentity {
  readonly issuer: string
  readonly subject: string
  readonly email: string
  readonly emailVerifiedAt: Date
  readonly displayName: string
  readonly authTime: Date
  readonly amr: readonly string[]
  readonly aal: number
  readonly sid: string | null
  readonly acr: string | null
  readonly idToken: string
}

export interface IdTokenVerifier {
  verify(idToken: string, nonceHash: Buffer): Promise<VerifiedIdentity>
}

export interface IdTokenVerifierOptions {
  readonly issuer: string
  readonly clientId: string
  readonly keySet: JWTVerifyGetKey
  readonly clockToleranceSeconds?: number
  readonly now?: () => Date
}

const ALLOWED_ALGORITHMS = ['RS256', 'ES256', 'PS256']
const MAX_TOKEN_LENGTH = 32_768
const MAX_AMR_LENGTH = 16
const MULTI_FACTOR_AMR = new Set(['mfa'])
const SECOND_FACTOR_AMR = new Set(['otp', 'hwk', 'swk', 'webauthn', 'passkey'])

/**
 * Verify an ID token exactly once, at login. Signature, issuer, audience,
 * authorized party, nonce, expiry and required identity claims are checked
 * before the claims cross into the application.
 */
export function createIdTokenVerifier(
  options: IdTokenVerifierOptions,
): IdTokenVerifier {
  const now = options.now ?? (() => new Date())
  const tolerance = options.clockToleranceSeconds ?? 60

  return {
    async verify(idToken: string, nonceHash: Buffer): Promise<VerifiedIdentity> {
      if (idToken.length === 0 || idToken.length > MAX_TOKEN_LENGTH) {
        throw new InvalidIdTokenError()
      }

      let payload
      try {
        const result = await jwtVerify(idToken, options.keySet, {
          issuer: options.issuer,
          audience: options.clientId,
          algorithms: ALLOWED_ALGORITHMS,
          clockTolerance: tolerance,
        })
        payload = result.payload
      } catch {
        throw new InvalidIdTokenError()
      }

      if (!audienceIsClient(payload.aud, options.clientId)) {
        throw new InvalidIdTokenError()
      }
      if (payload.azp !== options.clientId) throw new InvalidIdTokenError()

      const nonce = payload.nonce
      if (typeof nonce !== 'string' || !constantTimeEqual(hashToken(nonce), nonceHash)) {
        throw new InvalidIdTokenError()
      }

      const subject = boundedText(payload.sub, 1, 255)
      const email = boundedText(payload.email, 3, 320).toLowerCase()
      if (payload.email_verified !== true) throw new InvalidIdTokenError()

      const authTime = numericDate(payload.auth_time)
      if (authTime.getTime() > now().getTime() + tolerance * 1_000) {
        throw new InvalidIdTokenError()
      }

      const amr = readAmr(payload.amr)
      const sid = optionalBoundedText(payload.sid, 255)
      const acr = optionalBoundedText(payload.acr, 255)
      const displayName = readDisplayName(payload, email)

      return {
        issuer: options.issuer,
        subject,
        email,
        emailVerifiedAt: now(),
        displayName,
        authTime,
        amr,
        aal: assuranceLevel(amr),
        sid,
        acr,
        idToken,
      }
    },
  }
}

function audienceIsClient(aud: unknown, clientId: string): boolean {
  if (typeof aud === 'string') return aud === clientId
  if (!Array.isArray(aud)) return false
  const audiences: unknown[] = aud
  return audiences.length > 0 && audiences.includes(clientId)
}

/**
 * A passkey alone is single-factor. Count a second factor only when the
 * provider asserts multi-factor authentication, or when a password is combined
 * with a hardware or one-time-password method.
 */
function assuranceLevel(amr: readonly string[]): number {
  if (amr.some((method) => MULTI_FACTOR_AMR.has(method))) return 2
  return amr.includes('pwd') && amr.some((method) => SECOND_FACTOR_AMR.has(method))
    ? 2
    : 1
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right)
}

function boundedText(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new InvalidIdTokenError()
  const text = value.trim()
  if (text.length < min || text.length > max) throw new InvalidIdTokenError()
  return text
}

function optionalBoundedText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return boundedText(value, 1, max)
}

function numericDate(value: unknown): Date {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new InvalidIdTokenError()
  }
  return new Date(value * 1_000)
}

function readAmr(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AMR_LENGTH) {
    throw new InvalidIdTokenError()
  }

  const methods: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new InvalidIdTokenError()
    }
    methods.push(item)
  }
  return methods
}

function readDisplayName(payload: Record<string, unknown>, email: string): string {
  for (const value of [payload.name, payload.preferred_username]) {
    if (typeof value === 'string') {
      const name = value.trim()
      if (name.length > 0 && name.length <= 200) return name
    }
  }
  return email
}
