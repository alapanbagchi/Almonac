import { describe, expect, test } from 'bun:test'
import {
  createAuthRateLimit,
  RATE_LIMITS,
  type RateLimitRoute,
} from '../../src/controllers/auth/dependencies'
import type { RateLimitWindow } from '../../src/repositories/rate-limit-repository'
import { AppError } from '../../src/shared/errors'
import { NOW, RecordingMetrics } from './auth-fixtures'

class FixedWindowStore {
  readonly hits = new Map<string, number>()
  readonly keys: Buffer[] = []

  async hit(keyHash: Buffer, windowSeconds: number, at: Date): Promise<RateLimitWindow> {
    void windowSeconds
    this.keys.push(keyHash)
    const key = keyHash.toString('hex')
    const count = (this.hits.get(key) ?? 0) + 1
    this.hits.set(key, count)
    return { count, windowStart: at }
  }
}

const options = (store: FixedWindowStore, metrics = new RecordingMetrics()) => ({
  store,
  metrics,
  clock: () => NOW,
})

async function expectLimited(promise: Promise<void>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected a RATE_LIMITED rejection')
}

describe('auth rate limit', () => {
  test('allows the budget and rejects the next request with a retry hint', async () => {
    const store = new FixedWindowStore()
    const metrics = new RecordingMetrics()
    const limiter = createAuthRateLimit(options(store, metrics))

    for (let attempt = 0; attempt < RATE_LIMITS.login; attempt += 1) {
      await limiter.check('login', '203.0.113.7')
    }

    const failure = await expectLimited(limiter.check('login', '203.0.113.7'))
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.status).toBe(429)
    expect(failure.headers?.['retry-after']).toBe('60')
    expect(metrics.counts).toEqual([
      { name: 'auth.rate_limited', attributes: { route: 'login' } },
    ])
  })

  test('counts each route and each address separately', async () => {
    const store = new FixedWindowStore()
    const limiter = createAuthRateLimit(options(store))

    for (let attempt = 0; attempt < RATE_LIMITS.register; attempt += 1) {
      await limiter.check('register', '203.0.113.7')
    }
    await expectLimited(limiter.check('register', '203.0.113.7'))

    // A different route has its own budget.
    await limiter.check('login', '203.0.113.7')
    // A different address has its own budget.
    await limiter.check('register', '198.51.100.9')
  })

  test('never stores the address itself', async () => {
    const store = new FixedWindowStore()
    const limiter = createAuthRateLimit(options(store))
    await limiter.check('login', '203.0.113.7')

    const key = store.keys[0]
    expect(key).toBeDefined()
    expect(key?.toString('utf8')).not.toContain('203.0.113.7')
    expect(key?.length).toBe(32)
  })

  test('an unattributed request shares one budget', async () => {
    const store = new FixedWindowStore()
    const limiter = createAuthRateLimit(options(store))

    for (let attempt = 0; attempt < RATE_LIMITS.step_up; attempt += 1) {
      await limiter.check('step_up', null)
    }
    await expectLimited(limiter.check('step_up', null))
    await expectLimited(limiter.check('step_up', null))
  })

  test('the route budgets match the documented contract', () => {
    const routes: RateLimitRoute[] = ['login', 'callback', 'step_up', 'register', 'verify', 'password']
    expect(Object.keys(RATE_LIMITS).sort()).toEqual([...routes].sort())
    expect(RATE_LIMITS).toEqual({
      login: 30,
      callback: 30,
      step_up: 10,
      register: 5,
      verify: 10,
      password: 10,
    })
  })
})
