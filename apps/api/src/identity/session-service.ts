import {
  hashToken,
  isSessionToken,
  mintToken,
} from '../shared/tokens'
import type { NewWebSession, WebSession } from './session-repository'

/** Provisional values. Shared-workstation policy must sign these off before P3. */
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1_000
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1_000
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1_000

export interface SessionStore {
  create(input: NewWebSession): Promise<WebSession>
  findByTokenHash(tokenHash: Buffer): Promise<WebSession | null>
  touch(id: string, at: Date, idleExpiresAt: Date): Promise<boolean>
  revoke(id: string, at: Date, reason: string): Promise<boolean>
}

export interface MintSessionInput {
  readonly userId: string
  readonly identityIssuer: string
  readonly zitadelSessionId: string | null
  readonly oidcSid: string | null
  readonly acr: string | null
  readonly idTokenHintCiphertext: Buffer | null
  readonly keyVersion: number | null
  readonly amr: readonly string[]
  readonly authTime: Date
  readonly aal: number
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

export interface SessionChanges {
  readonly amr?: readonly string[]
  readonly authTime?: Date
  readonly aal?: number
  readonly acr?: string | null
  readonly oidcSid?: string | null
  readonly idTokenHintCiphertext?: Buffer | null
  readonly keyVersion?: number | null
}

export interface IssuedSession {
  readonly token: string
  readonly expiresAt: Date
  readonly session: WebSession
}

export interface SessionServiceOptions {
  readonly store: SessionStore
  readonly clock?: () => Date
  readonly idleTimeoutMs?: number
  readonly absoluteTimeoutMs?: number
  readonly touchIntervalMs?: number
}

/**
 * Create, resolve and revoke API sessions. The service owns the expiry policy
 * and the touch throttle; the repository owns the SQL. A token is returned
 * once and only its hash is stored.
 */
export class SessionService {
  private readonly store: SessionStore
  private readonly clock: () => Date
  private readonly idleTimeoutMs: number
  private readonly absoluteTimeoutMs: number
  private readonly touchIntervalMs: number

  constructor(options: SessionServiceOptions) {
    this.store = options.store
    this.clock = options.clock ?? (() => new Date())
    this.idleTimeoutMs = options.idleTimeoutMs ?? SESSION_IDLE_TIMEOUT_MS
    this.absoluteTimeoutMs = options.absoluteTimeoutMs ?? SESSION_ABSOLUTE_TIMEOUT_MS
    this.touchIntervalMs = options.touchIntervalMs ?? SESSION_TOUCH_INTERVAL_MS

    if (this.idleTimeoutMs <= 0 || this.absoluteTimeoutMs <= 0) {
      throw new Error('session timeouts must be positive')
    }
    if (this.idleTimeoutMs > this.absoluteTimeoutMs) {
      throw new Error('session idle timeout must not exceed the absolute timeout')
    }
    if (this.touchIntervalMs < 0) {
      throw new Error('session touch interval must not be negative')
    }
  }

  async mint(input: MintSessionInput): Promise<IssuedSession> {
    if ((input.idTokenHintCiphertext === null) !== (input.keyVersion === null)) {
      throw new Error('session id token hint and key version must be paired')
    }

    const now = this.clock()
    const absoluteExpiresAt = new Date(now.getTime() + this.absoluteTimeoutMs)
    const idleExpiresAt = new Date(now.getTime() + this.idleTimeoutMs)
    const { token, tokenHash } = mintToken()

    const session = await this.store.create({
      userId: input.userId,
      identityIssuer: input.identityIssuer,
      tokenHash,
      zitadelSessionId: input.zitadelSessionId,
      oidcSid: input.oidcSid,
      acr: input.acr,
      idTokenHintCiphertext: input.idTokenHintCiphertext,
      keyVersion: input.keyVersion,
      amr: input.amr,
      authTime: input.authTime,
      aal: input.aal,
      idleExpiresAt,
      absoluteExpiresAt,
      ip: input.ip,
      userAgentHash: input.userAgentHash,
    })

    return { token, expiresAt: idleExpiresAt, session }
  }

  /**
   * Resolve a bearer token. A valid session is touched at most once per
   * interval. The returned session reflects the new idle expiry.
   */
  async authenticate(token: string): Promise<WebSession | null> {
    if (!isSessionToken(token)) return null

    const now = this.clock()
    const session = await this.store.findByTokenHash(hashToken(token))
    if (session === null || !isActive(session, now)) return null

    if (now.getTime() - session.lastSeenAt.getTime() < this.touchIntervalMs) {
      return session
    }

    const idleExpiresAt = new Date(now.getTime() + this.idleTimeoutMs)
    if (!(await this.store.touch(session.id, now, idleExpiresAt))) return null

    return { ...session, lastSeenAt: now, idleExpiresAt }
  }

  /**
   * Rotate a session after step-up. The old row is revoked before the new row
   * is created; a race or a create failure logs the user out instead of
   * leaving two valid tokens.
   */
  async rotate(
    token: string,
    changes: SessionChanges = {},
  ): Promise<IssuedSession | null> {
    if (!isSessionToken(token)) return null

    const now = this.clock()
    const session = await this.store.findByTokenHash(hashToken(token))
    if (session === null || !isActive(session, now)) return null

    const idTokenHintCiphertext =
      changes.idTokenHintCiphertext === undefined
        ? session.idTokenHintCiphertext
        : changes.idTokenHintCiphertext
    const keyVersion =
      changes.keyVersion === undefined ? session.keyVersion : changes.keyVersion
    const acr = changes.acr === undefined ? session.acr : changes.acr
    const oidcSid = changes.oidcSid === undefined ? session.oidcSid : changes.oidcSid
    if ((idTokenHintCiphertext === null) !== (keyVersion === null)) {
      throw new Error('session id token hint and key version must be paired')
    }
    if (!(await this.store.revoke(session.id, now, 'rotated'))) return null

    const { token: nextToken, tokenHash } = mintToken()
    const idleExpiresAt = new Date(now.getTime() + this.idleTimeoutMs)

    const next = await this.store.create({
      userId: session.userId,
      identityIssuer: session.identityIssuer,
      tokenHash,
      zitadelSessionId: session.zitadelSessionId,
      oidcSid,
      acr,
      idTokenHintCiphertext,
      keyVersion,
      amr: changes.amr ?? session.amr,
      authTime: changes.authTime ?? session.authTime,
      aal: changes.aal ?? session.aal,
      idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      ip: session.ip,
      userAgentHash: session.userAgentHash,
    })

    return { token: nextToken, expiresAt: idleExpiresAt, session: next }
  }

  async revoke(token: string, reason: string): Promise<boolean> {
    if (!isSessionToken(token)) return false

    const session = await this.store.findByTokenHash(hashToken(token))
    if (session === null) return false

    return this.store.revoke(session.id, this.clock(), reason)
  }
}

function isActive(session: WebSession, now: Date): boolean {
  return (
    session.revokedAt === null &&
    session.absoluteExpiresAt.getTime() > now.getTime() &&
    session.idleExpiresAt.getTime() > now.getTime()
  )
}