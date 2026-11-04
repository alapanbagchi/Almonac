import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { RateLimiter } from '../../src/auth/rate-limiter'
import type { RateLimitStore, RateLimitWindow } from '../../src/auth/rate-limit-repository'
import { AppError } from '../../src/shared/errors'

const AT = new Date('2026-01-01T10:00:30.000Z')

function storeReturning(count: number, windowStart = new Date(AT.getTime() - 30_000)) {
  const seen: { count: number; keyHash?: Buffer; windowSeconds?: number; at?: Date } = { count }
  const store: RateLimitStore = {
    async hit(keyHash, windowSeconds, at): Promise<RateLimitWindow> {
      seen.keyHash = keyHash
      seen.windowSeconds = windowSeconds
      seen.at = at
      return { count: seen.count, windowStart }
    },
  }
  return { store, seen }
}

describe('auth rate limiter', () => {
  test('allows a request at the limit', async () => {
    const { store } = storeReturning(30)
    const limiter = new RateLimiter({ store, clock: () => AT })

    await expect(limiter.check('login', '203.0.113.7')).resolves.toBeUndefined()
  })

  test('rejects a request above the limit with a retry delay', async () => {
    const { store } = storeReturning(31)
    const limiter = new RateLimiter({ store, clock: () => AT })

    const error = await limiter.check('login', '203.0.113.7').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    const failure = error as AppError
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.status).toBe(429)
    expect(failure.headers['retry-after']).toBe('30')
  })

  test('counts per route and stores only a digest of the address', async () => {
    const { store, seen } = storeReturning(1)
    const limiter = new RateLimiter({ store, clock: () => AT })

    await limiter.check('step_up', '203.0.113.7')

    expect(seen.windowSeconds).toBe(60)
    expect(seen.at).toEqual(AT)
    expect(seen.keyHash).toEqual(
      createHash('sha256').update('step_up\n203.0.113.7').digest(),
    )
    expect(seen.keyHash?.includes('203.0.113.7')).toBe(false)
  })

  test('shares one bucket when the address is unknown', async () => {
    const { store, seen } = storeReturning(1)
    const limiter = new RateLimiter({ store, clock: () => AT })

    await limiter.check('login', null)

    expect(seen.keyHash).toEqual(
      createHash('sha256').update('login\nunattributed').digest(),
    )
  })

  test('resets the budget in a new window', async () => {
    const { store } = storeReturning(1, AT)
    const limiter = new RateLimiter({ store, clock: () => AT })

    await expect(limiter.check('callback', '203.0.113.7')).resolves.toBeUndefined()
  })
})
