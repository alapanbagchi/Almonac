import { createHash } from 'node:crypto'
import { AppError } from '../shared/errors'
import { NO_METRICS, type Metrics } from '../shared/metrics'
import type { RateLimitStore } from './rate-limit-repository'

export type RateLimitRoute =
  | 'login'
  | 'callback'
  | 'step_up'
  | 'register'
  | 'verify'
  | 'password'

/** Requests allowed per client address per minute, per route. */
export const RATE_LIMITS: Readonly<Record<RateLimitRoute, number>> = {
  login: 30,
  callback: 30,
  step_up: 10,
  register: 5,
  verify: 10,
  password: 10,
}

const WINDOW_SECONDS = 60

/** Throws when the caller has spent its budget for the current window. */
export interface AuthRateLimit {
  check(route: RateLimitRoute, ip: string | null): Promise<void>
}

export interface RateLimiterOptions {
  readonly store: RateLimitStore
  readonly metrics?: Metrics
  readonly clock?: () => Date
}

/**
 * Fixed-window rate limiting for the unauthenticated auth routes. The counter
 * key is a digest, so neither the table nor a log line holds an IP address.
 * A request without a peer address shares the 'unattributed' bucket; the
 * deployment must keep the client address visible to Bun through its proxy.
 */
export class RateLimiter implements AuthRateLimit {
  private readonly clock: () => Date
  private readonly metrics: Metrics

  constructor(private readonly options: RateLimiterOptions) {
    this.clock = options.clock ?? (() => new Date())
    this.metrics = options.metrics ?? NO_METRICS
  }

  async check(route: RateLimitRoute, ip: string | null): Promise<void> {
    const now = this.clock()
    const keyHash = createHash('sha256')
      .update(`${route}\n${ip ?? 'unattributed'}`)
      .digest()
    const { count, windowStart } = await this.options.store.hit(
      keyHash,
      WINDOW_SECONDS,
      now,
    )
    if (count <= RATE_LIMITS[route]) return

    this.metrics.count('auth.rate_limited', { route })

    const resetAt = windowStart.getTime() + WINDOW_SECONDS * 1_000
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now.getTime()) / 1_000))
    throw new AppError(
      'RATE_LIMITED',
      429,
      'Too many requests. Try again shortly.',
      { headers: { 'retry-after': String(retryAfterSeconds) } },
    )
  }
}
