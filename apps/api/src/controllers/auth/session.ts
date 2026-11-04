import { hashToken, isSessionToken, mintToken } from '../../shared/tokens'
import { NO_METRICS, type Metrics } from '../../shared/metrics'
import { authenticateBearer, type AuthenticatedRequest } from '../../guards/bearer'
import type { NewWebSession, WebSession } from '../../repositories/session-repository'
import { createSessionRepository } from '../../repositories/session-repository'
import { createAppUserRepository } from '../../repositories/app-user-repository'
import { clockOf, type AuthDependencies } from './dependencies'

/** Provisional values. Shared-workstation policy must sign these off before P3. */
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1_000
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1_000
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1_000
export const SESSION_ID_TOKEN_HINT_AAD = 'almonac:web-session:id-token-hint'

/** The four persistence operations the expiry policy needs. */
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
  /** Absolute expiry. Idle expiry stays server-side. */
  readonly expiresAt: Date
  readonly session: WebSession
}

export interface SessionService {
  mint(input: MintSessionInput): Promise<IssuedSession>
  findByToken(token: string): Promise<WebSession | null>
  authenticate(token: string): Promise<WebSession | null>
  rotate(token: string, changes?: SessionChanges): Promise<IssuedSession | null>
  revoke(token: string, reason: string): Promise<boolean>
}

export interface SessionServiceOptions {
  readonly store: SessionStore
  readonly clock?: () => Date
  readonly idleTimeoutMs?: number
  readonly absoluteTimeoutMs?: number
  readonly touchIntervalMs?: number
  readonly metrics?: Metrics
}

/**
 * Create, resolve and revoke API sessions. The service owns the expiry policy
 * and the touch throttle; the repository owns the SQL. A token is returned
 * once and only its hash is stored.
 */
export function createSessionService(options: SessionServiceOptions): SessionService {
  const clock = options.clock ?? (() => new Date())
  const idleTimeoutMs = options.idleTimeoutMs ?? SESSION_IDLE_TIMEOUT_MS
  const absoluteTimeoutMs = options.absoluteTimeoutMs ?? SESSION_ABSOLUTE_TIMEOUT_MS
  const touchIntervalMs = options.touchIntervalMs ?? SESSION_TOUCH_INTERVAL_MS
  const metrics = options.metrics ?? NO_METRICS

  if (idleTimeoutMs <= 0 || absoluteTimeoutMs <= 0) {
    throw new Error('session timeouts must be positive')
  }
  if (idleTimeoutMs > absoluteTimeoutMs) {
    throw new Error('session idle timeout must not exceed the absolute timeout')
  }
  if (touchIntervalMs < 0) {
    throw new Error('session touch interval must not be negative')
  }

  async function findByToken(token: string): Promise<WebSession | null> {
    if (!isSessionToken(token)) return null
    return options.store.findByTokenHash(hashToken(token))
  }

  return {
    async mint(input) {
      if ((input.idTokenHintCiphertext === null) !== (input.keyVersion === null)) {
        throw new Error('session id token hint and key version must be paired')
      }

      const now = clock()
      const absoluteExpiresAt = new Date(now.getTime() + absoluteTimeoutMs)
      const idleExpiresAt = new Date(now.getTime() + idleTimeoutMs)
      const { token, tokenHash } = mintToken()

      const session = await options.store.create({
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

      return { token, expiresAt: absoluteExpiresAt, session }
    },

    findByToken,

    /**
     * A valid session is touched at most once per interval. The returned
     * session reflects the new idle expiry.
     */
    async authenticate(token) {
      const now = clock()
      const session = await findByToken(token)
      if (session === null || !isActive(session, now)) return null

      if (now.getTime() - session.lastSeenAt.getTime() < touchIntervalMs) {
        return session
      }

      const idleExpiresAt = new Date(now.getTime() + idleTimeoutMs)
      if (!(await options.store.touch(session.id, now, idleExpiresAt))) return null

      return { ...session, lastSeenAt: now, idleExpiresAt }
    },

    /**
     * Rotate a session after step-up. The old row is revoked before the new row
     * is created; a race or a create failure logs the user out instead of
     * leaving two valid tokens.
     */
    async rotate(token, changes = {}) {
      if (!isSessionToken(token)) return null

      const now = clock()
      const session = await findByToken(token)
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
      if (!(await options.store.revoke(session.id, now, 'rotated'))) return null
      metrics.count('auth.session_revoked', { reason: 'rotated' })

      const { token: nextToken, tokenHash } = mintToken()
      const idleExpiresAt = new Date(now.getTime() + idleTimeoutMs)

      const next = await options.store.create({
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

      return {
        token: nextToken,
        expiresAt: session.absoluteExpiresAt,
        session: next,
      }
    },

    async revoke(token, reason) {
      const session = await findByToken(token)
      if (session === null) return false

      const revoked = await options.store.revoke(session.id, clock(), reason)
      if (revoked) metrics.count('auth.session_revoked', { reason })
      return revoked
    },
  }
}

function isActive(session: WebSession, now: Date): boolean {
  return (
    session.revokedAt === null &&
    session.absoluteExpiresAt.getTime() > now.getTime() &&
    session.idleExpiresAt.getTime() > now.getTime()
  )
}

/** The session service every controller in this slice shares. */
export function sessionServiceOf(dependencies: AuthDependencies): SessionService {
  return createSessionService({
    store: createSessionRepository(dependencies.db),
    clock: clockOf(dependencies),
    ...(dependencies.metrics === undefined ? {} : { metrics: dependencies.metrics }),
  })
}

/**
 * Resolve the bearer session for a private API hop. The API never reads
 * cookies; a missing or malformed credential is an authentication failure.
 */
export async function authenticateRequest(
  dependencies: AuthDependencies,
  authorization: string | null | undefined,
): Promise<AuthenticatedRequest> {
  return authenticateBearer(
    authorization,
    sessionServiceOf(dependencies),
    createAppUserRepository(dependencies.db),
  )
}

