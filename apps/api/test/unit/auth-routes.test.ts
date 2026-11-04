import { describe, expect, test } from 'bun:test'
import { AppError } from '../../src/shared/errors'
import type { AuthDependencies } from '../../src/auth/routes'
import type { AppUser } from '../../src/identity/app-user-repository'
import type { SessionAccess } from '../../src/identity/access-repository'
import type { WebSession } from '../../src/identity/session-repository'
import { createTestApp } from '../helpers/app'

const NOW = new Date('2026-01-01T10:00:00.000Z')

const user: AppUser = {
  id: 'user-1',
  identityIssuer: 'https://identity.example.test',
  zitadelSubject: 'subject-1',
  email: 'doctor@example.test',
  emailVerifiedAt: NOW,
  displayName: 'Dev Doctor',
  homeOrganisationId: null,
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
  lastLoginAt: null,
}

const session: WebSession = {
  id: 'session-1',
  userId: user.id,
  identityIssuer: user.identityIssuer,
  tokenHash: Buffer.alloc(32),
  zitadelSessionId: null,
  oidcSid: 'sid-1',
  acr: null,
  idTokenHintCiphertext: null,
  keyVersion: null,
  amr: ['pwd'],
  authTime: NOW,
  aal: 1,
  createdAt: NOW,
  lastSeenAt: NOW,
  idleExpiresAt: new Date(NOW.getTime() + 60_000),
  absoluteExpiresAt: new Date(NOW.getTime() + 120_000),
  revokedAt: null,
  revokeReason: null,
  ip: null,
  userAgentHash: null,
}

const access: SessionAccess = {
  memberships: [
    {
      id: 'membership-1',
      organisationId: 'org-1',
      organisationName: 'Almonac',
      hospitalId: 'hospital-1',
      hospitalName: 'General',
      startsAt: NOW,
      endsAt: null,
      roles: ['clinician'],
    },
  ],
  permissions: ['clinical.read'],
}

function dependencies(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    login: {
      async start(returnTo) {
        return {
          authorizationUrl: `https://identity.example.test/authorize?returnTo=${String(returnTo)}`,
          expiresAt: new Date(NOW.getTime() + 600_000),
        }
      },
      async startStepUp(userId, returnTo) {
        return {
          authorizationUrl: `https://identity.example.test/authorize?stepUp=${userId}&returnTo=${String(returnTo)}`,
          expiresAt: new Date(NOW.getTime() + 600_000),
        }
      },
      async complete() {
        return {
          token: 't'.repeat(43),
          expiresAt: new Date(NOW.getTime() + 60_000),
          returnTo: '/dashboard',
          sessionId: session.id,
          userId: user.id,
        }
      },
    },
    sessions: {
      async authenticate(token) {
        return token === 'v'.repeat(43) ? session : null
      },
      async revoke() {
        return true
      },
    },
    users: {
      async findById() {
        return user
      },
    },
    access: {
      async listForUser() {
        return access
      },
    },
    logout: {
      async logout() {
        return { endSessionUrl: 'https://identity.example.test/logout' }
      },
    },
    ...overrides,
  }
}

function app(overrides: Partial<AuthDependencies> = {}) {
  return createTestApp(async () => {}, 50, dependencies(overrides))
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('auth routes', () => {
  test('starts a login and returns only the authorization URL', async () => {
    const response = await app().handle(post('/v1/auth/login-attempts', { returnTo: '/dashboard' }))
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const body = (await response.json()) as Record<string, unknown>
    expect(String(body.authorizationUrl)).toContain('identity.example.test')
    expect(Object.keys(body).sort()).toEqual(['authorizationUrl', 'expiresAt'])
    expect(JSON.stringify(body)).not.toContain('t'.repeat(43))
  })

  test('returns a validation envelope for a bad return target', async () => {
    const response = await app({
      login: {
        async start() {
          throw new AppError('VALIDATION_FAILED', 400, 'returnTo must be an internal path.')
        },
        async startStepUp() {
          throw new Error('unused')
        },
        async complete() {
          throw new Error('unused')
        },
      },
    }).handle(post('/v1/auth/login-attempts', { returnTo: 'https://evil.test' }))
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('VALIDATION_FAILED')
  })

  test('starts a step-up only for an authenticated session', async () => {
    const missing = await app().handle(
      post('/v1/auth/step-up-attempts', { returnTo: '/dashboard' }),
    )
    expect(missing.status).toBe(401)

    const response = await app().handle(
      post(
        '/v1/auth/step-up-attempts',
        { returnTo: '/dashboard' },
        { authorization: `Bearer ${'v'.repeat(43)}` },
      ),
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, unknown>
    expect(String(body.authorizationUrl)).toContain('stepUp=user-1')
  })

  test('forwards the bearer token on a step-up callback', async () => {
    const seen: { token: string | null } = { token: null }
    const response = await app({
      login: {
        async start() {
          throw new Error('unused')
        },
        async startStepUp() {
          throw new Error('unused')
        },
        async complete(_code, _state, _context, token) {
          seen.token = token ?? null
          return {
            token: 't'.repeat(43),
            expiresAt: new Date(NOW.getTime() + 60_000),
            returnTo: '/dashboard',
            sessionId: session.id,
            userId: user.id,
          }
        },
      },
    }).handle(
      post(
        '/v1/auth/callback',
        { code: 'code-1', state: 's'.repeat(43) },
        { authorization: `Bearer ${'v'.repeat(43)}` },
      ),
    )
    expect(response.status).toBe(200)
    expect(seen.token).toBe('v'.repeat(43))
  })

  test('completes a callback with no-store and no-referrer headers', async () => {
    const response = await app().handle(
      post('/v1/auth/callback', { code: 'code-1', state: 's'.repeat(43) }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const body = (await response.json()) as Record<string, unknown>
    expect(body.token).toBe('t'.repeat(43))
    expect(body.returnTo).toBe('/dashboard')
  })

  test('maps a callback rejection to a generic 401', async () => {
    const response = await app({
      login: {
        async start() {
          throw new Error('unused')
        },
        async startStepUp() {
          throw new Error('unused')
        },
        async complete() {
          throw new AppError('AUTH_FAILED', 401, 'Authentication failed.')
        },
      },
    }).handle(post('/v1/auth/callback', { code: 'code-1', state: 's'.repeat(43) }))
    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).toContain('Authentication failed.')
    expect(text).not.toContain('code-1')
  })

  test('requires a bearer token for the session route', async () => {
    const missing = await app().handle(new Request('http://localhost/v1/auth/session'))
    expect(missing.status).toBe(401)
    const malformed = await app().handle(
      new Request('http://localhost/v1/auth/session', {
        headers: { authorization: 'Basic abc' },
      }),
    )
    expect(malformed.status).toBe(401)
  })

  test('rejects an unknown bearer session', async () => {
    const response = await app().handle(
      new Request('http://localhost/v1/auth/session', {
        headers: { authorization: `Bearer ${'x'.repeat(43)}` },
      }),
    )
    expect(response.status).toBe(401)
  })

  test('returns the user, memberships and permissions for a valid bearer token', async () => {
    const response = await app().handle(
      new Request('http://localhost/v1/auth/session', {
        headers: { authorization: `Bearer ${'v'.repeat(43)}` },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as Record<string, unknown>
    expect(body.user).toMatchObject({ id: 'user-1', email: 'doctor@example.test' })
    expect(body.permissions).toEqual(['clinical.read'])
    expect(JSON.stringify(body)).not.toContain('v'.repeat(43))
  })

  test('logs out the current session and returns a provider URL', async () => {
    const response = await app().handle(
      new Request('http://localhost/v1/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${'v'.repeat(43)}` },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      endSessionUrl: 'https://identity.example.test/logout',
    })
  })
})
