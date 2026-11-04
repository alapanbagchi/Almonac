import { describe, expect, test } from 'bun:test'
import { MfaRequiredError } from '../../src/adapters/zitadel/login-client'
import {
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../../src/adapters/zitadel/client'
import { passwordLogin } from '../../src/controllers/auth/password-login'
import type { AuthDependencies } from '../../src/controllers/auth/dependencies'
import { AppError } from '../../src/shared/errors'
import {
  CONTEXT,
  FakeDatabase,
  NOW,
  RecordingAudit,
  RecordingMetrics,
  baseDependencies,
  fakeLoginClient,
  fakeOidc,
  loginAttemptRow,
} from './auth-fixtures'

const STATE = 'S'.repeat(43)

function dependencies(
  overrides: Partial<AuthDependencies> = {},
): AuthDependencies {
  const db = new FakeDatabase([
    { match: /insert into identity\.login_attempt/, rows: loginAttemptRow },
  ])
  // The provider login echoes the state it was started with, like the real flow.
  let startedState = STATE
  return baseDependencies({
    db,
    clock: () => NOW,
    oidc: fakeOidc({
      async authorizationUrl(input) {
        startedState = input.state
        return `https://id.example.test/oauth/v2/authorize?state=${input.state}`
      },
    }),
    loginClient: fakeLoginClient({
      async start() {
        return 'auth-request-1'
      },
      async signIn() {
        return { sessionId: 'sess-1', sessionToken: 'token-1' }
      },
      async complete() {
        return `http://api.test/v1/auth/callback?code=code-1&state=${startedState}`
      },
    }),
    ...overrides,
  })
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError')
}

describe('password login', () => {
  test('returns the callback URL when the provider completes the request', async () => {
    const result = await passwordLogin(
      dependencies(),
      CONTEXT,
      { email: 'ada@example.test', password: 'correct horse', returnTo: '/dashboard' },
    )

    expect(result.callbackUrl).toStartWith('http://api.test/v1/auth/callback?code=code-1&state=')
    expect(new URL(result.callbackUrl).searchParams.get('state')).toHaveLength(43)
  })

  test('rejects an invalid email without calling the provider', async () => {
    let started = false
    const failure = await rejection(
      passwordLogin(
        dependencies({
          loginClient: fakeLoginClient({
            async start() {
              started = true
              return 'auth-request-1'
            },
          }),
        }),
        CONTEXT,
        { email: 'not-an-email', password: 'correct horse' },
      ),
    )

    expect(failure.code).toBe('INVALID_EMAIL')
    expect(failure.status).toBe(422)
    expect(started).toBe(false)
  })

  test('rejects an empty password without calling the provider', async () => {
    let started = false
    const failure = await rejection(
      passwordLogin(
        dependencies({
          loginClient: fakeLoginClient({
            async start() {
              started = true
              return 'auth-request-1'
            },
          }),
        }),
        CONTEXT,
        { email: 'ada@example.test', password: '' },
      ),
    )

    expect(failure.code).toBe('INVALID_CREDENTIALS')
    expect(failure.status).toBe(401)
    expect(started).toBe(false)
  })

  test('an oversized password is a validation failure', async () => {
    const failure = await rejection(
      passwordLogin(dependencies(), CONTEXT, {
        email: 'ada@example.test',
        password: 'a'.repeat(1_025),
      }),
    )

    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.status).toBe(400)
  })

  test('an MFA challenge answers 403 and is audited', async () => {
    const audit = new RecordingAudit()
    const failure = await rejection(
      passwordLogin(
        dependencies({
          audit,
          loginClient: fakeLoginClient({
            async signIn() {
              throw new MfaRequiredError()
            },
          }),
        }),
        CONTEXT,
        { email: 'ada@example.test', password: 'correct horse' },
      ),
    )

    expect(failure.code).toBe('MFA_REQUIRED')
    expect(failure.status).toBe(403)
    expect(audit.events).toHaveLength(1)
    const event = audit.events[0]
    expect(event?.eventType).toBe('auth.login_failed')
    expect(event?.outcome).toBe('failure')
    expect(event?.reasonCode).toBe('mfa_required')
    expect(event?.actorType).toBe('system')
    expect(event?.metadata).toEqual({ reason_code: 'mfa_required' })
  })

  test('rejected credentials are a generic 401 and are audited', async () => {
    const audit = new RecordingAudit()
    const metrics = new RecordingMetrics()
    const failure = await rejection(
      passwordLogin(
        dependencies({
          audit,
          metrics,
          loginClient: fakeLoginClient({
            async signIn() {
              throw new ZitadelRejectedError(401, null)
            },
          }),
        }),
        CONTEXT,
        { email: 'ada@example.test', password: 'wrong' },
      ),
    )

    expect(failure.code).toBe('UNAUTHENTICATED')
    expect(failure.message).toBe('Authentication failed.')
    expect(audit.events[0]?.reasonCode).toBe('invalid_credentials')
    expect(metrics.counts).toContainEqual({
      name: 'auth.login_failed',
      attributes: { reason: 'invalid_credentials' },
    })
  })

  test('a provider outage is a 503, not a credential failure', async () => {
    const audit = new RecordingAudit()
    const failure = await rejection(
      passwordLogin(
        dependencies({
          audit,
          loginClient: fakeLoginClient({
            async signIn() {
              throw new ZitadelUnavailableError('provider down')
            },
          }),
        }),
        CONTEXT,
        { email: 'ada@example.test', password: 'correct horse' },
      ),
    )

    expect(failure.code).toBe('AUTH_UNAVAILABLE')
    expect(failure.status).toBe(503)
    expect(audit.events[0]?.reasonCode).toBe('identity_unavailable')
  })

  test('a callback for another authorization request is refused', async () => {
    const audit = new RecordingAudit()
    const failure = await rejection(
      passwordLogin(
        dependencies({
          audit,
          loginClient: fakeLoginClient({
            async complete() {
              return `http://api.test/v1/auth/callback?code=code-1&state=${'T'.repeat(43)}`
            },
          }),
        }),
        CONTEXT,
        { email: 'ada@example.test', password: 'correct horse' },
      ),
    )

    expect(failure.code).toBe('AUTH_UNAVAILABLE')
    expect(failure.status).toBe(503)
    expect(audit.events[0]?.reasonCode).toBe('invalid_authorization')
  })

  test('an unexpected error is rethrown, not disguised as a login failure', async () => {
    await expect(
      passwordLogin(
        dependencies({
          loginClient: fakeLoginClient({
            async signIn() {
              throw new Error('bug')
            },
          }),
        }),
        CONTEXT,
        { email: 'ada@example.test', password: 'correct horse' },
      ),
    ).rejects.toThrow('bug')
  })

  test('the attempt stores the PKCE challenge, never the verifier', async () => {
    const db = new FakeDatabase([
      { match: /insert into identity\.login_attempt/, rows: loginAttemptRow },
    ])
    const audit = new RecordingAudit()
    await passwordLogin(
      dependencies({ db, audit }),
      CONTEXT,
      { email: 'ada@example.test', password: 'correct horse' },
    )

    const [insert] = db.statementsMatching(/insert into identity\.login_attempt/)
    expect(insert).toBeDefined()
    // state hash, nonce hash, sealed verifier and the user-agent fingerprint are bytes.
    expect(insert?.values.filter((value) => Buffer.isBuffer(value)).length).toBeGreaterThanOrEqual(3)
    expect(insert?.values).toContain('login')
  })
})
