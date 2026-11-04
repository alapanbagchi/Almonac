import { describe, expect, test } from 'bun:test'
import type { AuditEvent, AuditSink } from '../../src/audit/audit-writer'
import { LoginService, LoginRejectedError } from '../../src/auth/login-service'
import type {
  LoginAttempt,
  LoginAttemptStore,
  NewLoginAttempt,
} from '../../src/auth/login-attempt-repository'
import type { OidcProvider } from '../../src/auth/oidc-provider'
import type { VerifiedIdentity } from '../../src/auth/id-token-verifier'
import { LOGIN_ATTEMPT_AAD, SESSION_ID_TOKEN_HINT_AAD } from '../../src/auth/aad'
import { hashToken } from '../../src/shared/tokens'
import type {
  MetricAttributes,
  MetricName,
  Metrics,
} from '../../src/shared/metrics'
import { open, sealingKey } from '../../src/shared/sealed'

const START = new Date('2026-01-01T10:00:00.000Z')
const KEY = sealingKey(1, Buffer.alloc(32, 7))

type MutableAttempt = { -readonly [K in keyof LoginAttempt]: LoginAttempt[K] }

function attemptFrom(input: NewLoginAttempt): MutableAttempt {
  return {
    id: 'attempt-1',
    userId: input.userId,
    stateHash: input.stateHash,
    nonceHash: input.nonceHash,
    pkceVerifierCiphertext: input.pkceVerifierCiphertext,
    keyVersion: input.keyVersion,
    returnTo: input.returnTo,
    purpose: input.purpose,
    ip: input.ip,
    userAgentHash: input.userAgentHash,
    createdAt: START,
    expiresAt: input.expiresAt,
    consumedAt: null,
  }
}

class FakeAttempts implements LoginAttemptStore {
  readonly rows: MutableAttempt[] = []

  async create(input: NewLoginAttempt): Promise<LoginAttempt> {
    const row = attemptFrom(input)
    this.rows.push(row)
    return row
  }

  async consume(stateHash: Buffer, at: Date): Promise<LoginAttempt | null> {
    const row = this.rows.find((candidate) => candidate.stateHash.equals(stateHash))
    if (row === undefined || row.consumedAt !== null || row.expiresAt <= at) return null
    row.consumedAt = at
    return row
  }
}

interface RecordedMetric {
  readonly name: MetricName
  readonly attributes: MetricAttributes | undefined
}

class FakeMetrics implements Metrics {
  readonly counts: RecordedMetric[] = []

  count(name: MetricName, attributes?: MetricAttributes): void {
    this.counts.push({ name, attributes })
  }
}

class FakeAudit implements AuditSink {
  readonly events: AuditEvent[] = []
  fail = false

  async write(event: AuditEvent): Promise<void> {
    if (this.fail) throw new Error('audit down')
    this.events.push(event)
  }
}

const IDENTITY: VerifiedIdentity = {
  issuer: 'https://identity.example.test',
  subject: 'subject-1',
  email: 'doctor@example.test',
  emailVerifiedAt: START,
  displayName: 'Dev Doctor',
  authTime: START,
  amr: ['pwd', 'otp'],
  aal: 2,
  sid: 'sid-1',
  acr: 'urn:zitadel:iam:org:project:id:1:aud',
  idToken: 'signed.id.token',
}

class FakeOidc implements OidcProvider {
  unavailable = false
  startUnavailable = false
  reject = false
  futureAuthTime = false
  lastAuthorizationInput: {
    prompt?: string
    maxAgeSeconds?: number
  } | null = null

  async authorizationUrl(input: {
    state: string
    nonce: string
    challenge: string
    prompt?: string
    maxAgeSeconds?: number
  }): Promise<string> {
    this.lastAuthorizationInput = {
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.maxAgeSeconds === undefined
        ? {}
        : { maxAgeSeconds: input.maxAgeSeconds }),
    }
    if (this.startUnavailable) {
      const { OidcUnavailableError } = await import('../../src/auth/errors')
      throw new OidcUnavailableError()
    }
    const url = new URL('https://identity.example.test/authorize')
    url.searchParams.set('state', input.state)
    url.searchParams.set('nonce', input.nonce)
    url.searchParams.set('code_challenge', input.challenge)
    return url.toString()
  }

  async exchangeCode(): Promise<string> {
    if (this.unavailable) {
      const { OidcUnavailableError } = await import('../../src/auth/errors')
      throw new OidcUnavailableError()
    }
    if (this.reject) {
      const { OidcRejectedError } = await import('../../src/auth/errors')
      throw new OidcRejectedError()
    }
    return IDENTITY.idToken
  }

  async verifyIdToken(): Promise<VerifiedIdentity> {
    return this.futureAuthTime
      ? { ...IDENTITY, authTime: new Date(START.getTime() + 30_000) }
      : IDENTITY
  }

  async endSessionUrl(): Promise<string | null> {
    return 'https://identity.example.test/logout'
  }
}

class FakeCompletion {
  calls = 0
  stepUpCalls = 0
  reject = false
  lastInput: import('../../src/auth/login-service').LoginCompletionInput | null = null
  lastStepUpInput: import('../../src/auth/login-service').StepUpCompletionInput | null = null

  async complete(input: import('../../src/auth/login-service').LoginCompletionInput) {
    this.calls += 1
    this.lastInput = input
    if (this.reject) throw new LoginRejectedError('user_inactive', 'user-1')
    return this.result()
  }

  async completeStepUp(
    input: import('../../src/auth/login-service').StepUpCompletionInput,
  ) {
    this.stepUpCalls += 1
    this.lastStepUpInput = input
    if (this.reject) throw new LoginRejectedError('user_inactive', 'user-1')
    return this.result()
  }

  private result() {
    return {
      token: 'a'.repeat(43),
      expiresAt: new Date(START.getTime() + 60_000),
      returnTo: '/dashboard',
      sessionId: 'session-1',
      userId: 'user-1',
    }
  }
}

function service() {
  const attempts = new FakeAttempts()
  const audit = new FakeAudit()
  const oidc = new FakeOidc()
  const completion = new FakeCompletion()
  const metrics = new FakeMetrics()
  const login = new LoginService({
    attempts,
    oidc,
    completion,
    audit,
    metrics,
    sealingKey: KEY,
    clock: () => START,
  })
  return { login, attempts, audit, oidc, completion, metrics }
}

const context = { ip: '127.0.0.1', userAgentHash: null, requestId: 'request-1' }

describe('login service', () => {
  test('stores hashes and the sealed verifier, never the verifier itself', async () => {
    const { login, attempts } = service()
    const start = await login.start('/dashboard', context)
    const stored = attempts.rows[0]!
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    const nonce = new URL(start.authorizationUrl).searchParams.get('nonce')!

    expect(stored.stateHash.equals(hashToken(state))).toBe(true)
    expect(stored.nonceHash.equals(hashToken(nonce))).toBe(true)
    expect(stored.returnTo).toBe('/dashboard')
    expect(stored.purpose).toBe('login')
    expect(stored.pkceVerifierCiphertext.toString()).not.toContain('verifier')
    expect(
      open(
        {
          ciphertext: stored.pkceVerifierCiphertext,
          keyVersion: stored.keyVersion,
        },
        KEY,
        LOGIN_ATTEMPT_AAD,
      ).length,
    ).toBe(43)
  })

  test('completes a login once and rejects a replay', async () => {
    const { login, attempts, audit, completion } = service()
    const start = await login.start('/dashboard', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    const result = await login.complete('code-1', state, context)
    expect(result.token).toHaveLength(43)
    expect(result.returnTo).toBe('/dashboard')
    expect(completion.calls).toBe(1)
    expect(attempts.rows[0]?.consumedAt).toEqual(START)
    expect(audit.events).toHaveLength(0)

    await expect(login.complete('code-1', state, context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    expect(audit.events.at(-1)?.eventType).toBe('auth.login_failed')
  })

  test('counts logins without identifiers or token material', async () => {
    const { login, metrics } = service()
    const start = await login.start('/dashboard', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!

    await login.complete('code-1', state, context)
    await expect(login.complete('code-1', state, context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })

    expect(metrics.counts).toEqual([
      { name: 'auth.login_succeeded', attributes: { purpose: 'login' } },
      { name: 'auth.login_failed', attributes: { reason: 'invalid_attempt' } },
    ])
    const written = JSON.stringify(metrics.counts)
    expect(written).not.toContain('@')
    expect(written).not.toContain('code-1')
    expect(written).not.toContain('subject-1')
  })

  test('rejects a malformed state before touching the database', async () => {
    const { login, attempts } = service()
    await expect(login.complete('code', 'short', context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    expect(attempts.rows).toHaveLength(0)
  })

  test('rejects a step-up attempt on the login callback without a token', async () => {
    const { login, attempts, audit } = service()
    const start = await login.start('/', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    attempts.rows[0]!.purpose = 'step_up'
    attempts.rows[0]!.userId = 'user-1'
    await expect(login.complete('code', state, context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    expect(audit.events.at(-1)?.reasonCode).toBe('missing_session')
  })

  test('starts a step-up for the current user and forces re-authentication', async () => {
    const { login, attempts, oidc } = service()
    const start = await login.startStepUp('user-1', '/settings', context)
    const stored = attempts.rows[0]!

    expect(stored.purpose).toBe('step_up')
    expect(stored.userId).toBe('user-1')
    expect(stored.returnTo).toBe('/settings')
    expect(oidc.lastAuthorizationInput).toEqual({
      prompt: 'login',
      maxAgeSeconds: 0,
    })
    expect(start.authorizationUrl).toContain('identity.example.test')
  })

  test('completes a step-up with the current session token', async () => {
    const { login, completion } = service()
    const start = await login.startStepUp('user-1', '/settings', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    const result = await login.complete(
      'code-1',
      state,
      context,
      's'.repeat(43),
    )

    expect(result.token).toHaveLength(43)
    expect(completion.stepUpCalls).toBe(1)
    expect(completion.calls).toBe(0)
    expect(completion.lastStepUpInput?.sessionToken).toBe('s'.repeat(43))
    expect(completion.lastStepUpInput?.attempt.userId).toBe('user-1')
  })

  test('rejects a step-up callback without a session token', async () => {
    const { login, attempts, audit, completion } = service()
    const start = await login.startStepUp('user-1', '/settings', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    await expect(login.complete('code-1', state, context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    expect(completion.stepUpCalls).toBe(0)
    expect(completion.calls).toBe(0)
    expect(attempts.rows[0]?.consumedAt).toEqual(START)
    expect(audit.events.at(-1)?.reasonCode).toBe('missing_session')
  })

  test('maps an identity outage at start to 503', async () => {
    const { login, oidc } = service()
    oidc.startUnavailable = true
    await expect(login.start('/', context)).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      status: 503,
    })
  })

  test('clamps a provider authentication time ahead of the clock', async () => {
    const { login, oidc, completion } = service()
    oidc.futureAuthTime = true
    const start = await login.start('/', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    await login.complete('code', state, context)
    expect(completion.lastInput?.identity.authTime).toEqual(START)
  })

  test('maps identity outage to 503 and rejection to 401', async () => {
    const { login, oidc } = service()
    const first = await login.start('/', context)
    const firstState = new URL(first.authorizationUrl).searchParams.get('state')!
    oidc.unavailable = true
    await expect(login.complete('code', firstState, context)).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      status: 503,
    })

    const second = await login.start('/', context)
    const secondState = new URL(second.authorizationUrl).searchParams.get('state')!
    oidc.unavailable = false
    oidc.reject = true
    await expect(login.complete('code', secondState, context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
  })

  test('keeps the authentication failure when the audit write fails', async () => {
    const { login, audit, oidc } = service()
    const start = await login.start('/', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    audit.fail = true
    oidc.reject = true
    await expect(login.complete('code', state, context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    expect(audit.events).toHaveLength(0)
  })

  test('rejects a non-internal return target at start', async () => {
    const { login } = service()
    await expect(login.start('https://evil.test', context)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })

  test('seals the ID token hint with a dedicated key version', async () => {
    const { login, completion } = service()
    const start = await login.start('/', context)
    const state = new URL(start.authorizationUrl).searchParams.get('state')!
    await login.complete('code', state, context)
    const input = completion.lastInput!
    expect(input.keyVersion).toBe(1)
    expect(
      open(
        { ciphertext: input.idTokenHintCiphertext, keyVersion: input.keyVersion },
        KEY,
        SESSION_ID_TOKEN_HINT_AAD,
      ),
    ).toBe(IDENTITY.idToken)
  })
})