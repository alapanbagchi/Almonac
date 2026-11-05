import { createHash } from 'node:crypto'
import type { AuditSink } from '../../shared/audit-writer'
import type { DatabaseQuery, TransactionRunner } from '../../db/pool'
import { AppError } from '../../shared/errors'
import { NO_METRICS, type Metrics } from '../../shared/metrics'
import type { SealingKey } from '../../shared/sealed'
import type { OidcProvider } from '../../adapters/oidc/provider'
import type { LoginClient } from '../../adapters/zitadel/login-client'
import type { PasswordHasher } from '../../shared/password-hash'
import type { RateLimitRepository } from '../../repositories/rate-limit-repository'

/** The provider-side account creator, satisfied by the Zitadel management client. */
export interface VerifiedIdentityCreator {
  createVerifiedHumanUser(input: {
    email: string
    displayName: string
    passwordHash: string
  }): Promise<string>
}

export interface VerificationMailer {
  send(input: { to: string; token: string; expiresAt: Date }): Promise<void>
}

/** What every request context carries: nobody trusted, nothing cached. */
export interface LoginRequestContext {
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
  readonly requestId: string
}

/**
 * Everything the authentication slice needs from the process. Repositories are
 * built from `db` (or the transaction client) inside the controllers, so a
 * fake database and a fake clock are enough to test the whole slice.
 */
export interface AuthDependencies {
  readonly db: DatabaseQuery
  readonly transaction: TransactionRunner
  readonly oidc: OidcProvider
  readonly sealingKey: SealingKey
  readonly audit: AuditSink
  readonly mailer: VerificationMailer
  readonly identities: VerifiedIdentityCreator
  readonly loginClient: LoginClient
  readonly passwords: PasswordHasher
  readonly metrics?: Metrics
  readonly rateLimit?: AuthRateLimit
  readonly clock?: () => Date
  readonly loginAttemptTtlMs?: number
}

export function clockOf(dependencies: AuthDependencies): () => Date {
  return dependencies.clock ?? (() => new Date())
}

export function metricsOf(dependencies: AuthDependencies): Metrics {
  return dependencies.metrics ?? NO_METRICS
}

export type RateLimitRoute =
  | 'callback'
  | 'step_up'
  | 'register'
  | 'verify'
  | 'password'
  | 'invitation_claim'

/** Requests allowed per client address per minute, per route. */
export const RATE_LIMITS: Readonly<Record<RateLimitRoute, number>> = {
  callback: 30,
  step_up: 10,
  register: 5,
  verify: 10,
  password: 10,
  invitation_claim: 5,
}

const WINDOW_SECONDS = 60

/** Throws when the caller has spent its budget for the current window. */
export interface AuthRateLimit {
  check(route: RateLimitRoute, ip: string | null): Promise<void>
}

export interface RateLimitOptions {
  readonly store: RateLimitRepository
  readonly metrics?: Metrics
  readonly clock?: () => Date
}

/**
 * Fixed-window rate limiting for the unauthenticated auth routes. The counter
 * key is a digest, so neither the table nor a log line holds an IP address.
 */
export function createAuthRateLimit(options: RateLimitOptions): AuthRateLimit {
  const clock = options.clock ?? (() => new Date())
  const metrics = options.metrics ?? NO_METRICS

  return {
    async check(route, ip) {
      const now = clock()
      const keyHash = createHash('sha256')
        .update(`${route}\n${ip ?? 'unattributed'}`)
        .digest()
      const { count, windowStart } = await options.store.hit(keyHash, WINDOW_SECONDS, now)
      if (count <= RATE_LIMITS[route]) return

      metrics.count('auth.rate_limited', { route })

      const resetAt = windowStart.getTime() + WINDOW_SECONDS * 1_000
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetAt - now.getTime()) / 1_000),
      )
      throw new AppError('RATE_LIMITED', 429, 'Too many requests. Try again shortly.', {
        headers: { 'retry-after': String(retryAfterSeconds) },
      })
    },
  }
}