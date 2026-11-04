import { describe, expect, test } from 'bun:test'
import { challengeFor } from '../../src/adapters/oidc/provider'
import { OidcUnavailableError } from '../../src/adapters/oidc/token-client'
import {
  LOGIN_ATTEMPT_AAD,
  LOGIN_ATTEMPT_TTL_MS,
  beginLoginAttempt,
  normaliseReturnTo,
  startLogin,
} from '../../src/controllers/auth/start-login'
import { AppError } from '../../src/shared/errors'
import { open } from '../../src/shared/sealed'
import { hashToken } from '../../src/shared/tokens'
import {
  CONTEXT,
  FakeDatabase,
  NOW,
  TEST_KEY,
  baseDependencies,
  loginAttemptRow,
} from './auth-fixtures'

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError')
}

function stateOf(url: string): string {
  const state = new URL(url).searchParams.get('state')
  if (state === null) throw new Error('authorization URL has no state')
  return state
}

function challengeOf(url: string): string {
  const challenge = new URL(url).searchParams.get('code_challenge')
  if (challenge === null) throw new Error('authorization URL has no challenge')
  return challenge
}

describe('returnTo', () => {
  test('accepts an internal path and defaults to the root', () => {
    expect(normaliseReturnTo('/dashboard')).toBe('/dashboard')
    expect(normaliseReturnTo('/org/1?tab=staff#top')).toBe('/org/1?tab=staff#top')
    expect(normaliseReturnTo(undefined)).toBe('/')
    expect(normaliseReturnTo(null)).toBe('/')
    expect(normaliseReturnTo(undefined, '/dashboard')).toBe('/dashboard')
    expect(normaliseReturnTo('  /dashboard  ')).toBe('/dashboard')
  })

  test('rejects anything that could leave the site or smuggle bytes', () => {
    const rejected = [
      '',
      'https://evil.test',
      '//evil.test',
      '\\evil.test',
      '/a\\b',
      '/%2f%2fevil.test',
      '/%5c',
      '/%0d%0aLocation:%20https://evil.test',
      '/\u0000',
      'dashboard',
      `/${'a'.repeat(2_048)}`,
    ]
    for (const value of rejected) {
      expect(() => normaliseReturnTo(value)).toThrow()
    }
    expect(() => normaliseReturnTo(42)).toThrow()
  })
})

describe('startLogin', () => {
  test('stores only hashes and seals the verifier', async () => {
    const db = new FakeDatabase([
      { match: /insert into identity\.login_attempt/, rows: loginAttemptRow },
    ])
    const started = await startLogin(
      baseDependencies({ db, clock: () => NOW }),
      CONTEXT,
      '/dashboard',
    )

    expect(started.expiresAt).toBe(new Date(NOW.getTime() + LOGIN_ATTEMPT_TTL_MS).toISOString())
    const state = stateOf(started.authorizationUrl)
    expect(state).toHaveLength(43)

    const [insert] = db.statementsMatching(/insert into identity\.login_attempt/)
    expect(insert).toBeDefined()
    expect(insert?.values).toContainEqual(hashToken(state))
    expect(insert?.values).toContain('login')
    expect(insert?.values).toContain('/dashboard')
    // The state itself and the verifier never reach the row.
    expect(insert?.values).not.toContain(state)
    expect(insert?.values.some((value) => Buffer.isBuffer(value))).toBe(true)

    const sealed = insert?.values.find(
      (value): value is Buffer => Buffer.isBuffer(value) && value.length > 32,
    )
    expect(sealed).toBeDefined()
    const verifier = open(
      { ciphertext: sealed!, keyVersion: TEST_KEY.version },
      TEST_KEY,
      LOGIN_ATTEMPT_AAD,
    )
    expect(challengeFor(verifier)).toBe(challengeOf(started.authorizationUrl))
  })

  test('a hostile returnTo is a validation failure and writes nothing', async () => {
    const db = new FakeDatabase()
    let called = false
    const dependencies = baseDependencies({
      db,
      oidc: {
        async authorizationUrl() {
          called = true
          return 'https://id.example.test/authorize'
        },
        async exchangeCode() {
          throw new Error('unused')
        },
        async verifyIdToken() {
          throw new Error('unused')
        },
        async endSessionUrl() {
          return null
        },
      },
    })

    const failure = await rejection(startLogin(dependencies, CONTEXT, 'https://evil.test'))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.status).toBe(400)
    expect(called).toBe(false)
    expect(db.statements).toHaveLength(0)
  })

  test('a provider outage is a 503 and writes nothing', async () => {
    const db = new FakeDatabase()
    const dependencies = baseDependencies({
      db,
      oidc: {
        async authorizationUrl() {
          throw new OidcUnavailableError()
        },
        async exchangeCode() {
          throw new Error('unused')
        },
        async verifyIdToken() {
          throw new Error('unused')
        },
        async endSessionUrl() {
          return null
        },
      },
    })

    const failure = await rejection(startLogin(dependencies, CONTEXT, undefined))
    expect(failure.code).toBe('AUTH_UNAVAILABLE')
    expect(failure.status).toBe(503)
    expect(db.statements).toHaveLength(0)
  })

  test('step-up forces a fresh provider authentication and records its purpose', async () => {
    const db = new FakeDatabase([
      { match: /insert into identity\.login_attempt/, rows: loginAttemptRow },
    ])
    const seen: { prompt?: string; maxAgeSeconds?: number } = {}
    const dependencies = baseDependencies({
      db,
      oidc: {
        async authorizationUrl(input) {
          seen.prompt = input.prompt
          seen.maxAgeSeconds = input.maxAgeSeconds
          return `https://id.example.test/authorize?state=${input.state}`
        },
        async exchangeCode() {
          throw new Error('unused')
        },
        async verifyIdToken() {
          throw new Error('unused')
        },
        async endSessionUrl() {
          return null
        },
      },
    })

    await beginLoginAttempt(dependencies, CONTEXT, '/dashboard', 'user-1')

    expect(seen).toEqual({ prompt: 'login', maxAgeSeconds: 0 })
    const [insert] = db.statementsMatching(/insert into identity\.login_attempt/)
    expect(insert?.values).toContain('step_up')
    expect(insert?.values).toContain('user-1')
  })
})
