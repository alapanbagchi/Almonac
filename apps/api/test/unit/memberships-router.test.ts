import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { Pool } from 'pg'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import type { AppUser } from '../../src/identity/app-user-repository'
import type { WebSession } from '../../src/identity/session-repository'
import { errors } from '../../src/plugins/errors'
import { membershipsRouter } from '../../src/routes/memberships.router'
import { rolesRouter } from '../../src/routes/roles.router'
import { forbidden } from '../../src/shared/errors'
import { mintToken } from '../../src/shared/tokens'

const NOW = new Date()
const TOKEN = mintToken().token
const ORGANISATION_ID = '11111111-1111-4111-8111-111111111111'

const user: AppUser = {
  id: '44444444-4444-4444-8444-444444444444',
  identityIssuer: 'https://identity.example.test',
  zitadelSubject: 'subject-1',
  email: 'admin@example.test',
  emailVerifiedAt: NOW,
  displayName: 'Admin',
  homeOrganisationId: ORGANISATION_ID,
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
  oidcSid: null,
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

/** No query is expected: every case is refused before storage. */
function unusedPool(): Pool {
  const pool = new Pool()
  Object.defineProperty(pool, 'query', {
    value: async () => {
      throw new Error('the route must not reach the database')
    },
  })
  return pool
}

function dependencies(overrides: Partial<AdminDependencies> = {}): AdminDependencies {
  return {
    db: unusedPool(),
    transaction: (run) => run(unusedPool()),
    authorize: async () => undefined,
    permissions: async () => [],
    isPlatformAdmin: async () => false,
    audit: {
      async write() {
        throw new Error('the route must not write audit')
      },
    },
    sessions: {
      async authenticate(token) {
        return token === TOKEN ? session : null
      },
      async revoke() {
        return false
      },
    },
    users: {
      async findById(id) {
        return id === user.id ? user : null
      },
    },
    ...overrides,
  }
}

function app(admin: AdminDependencies) {
  return new Elysia().use(errors).use(membershipsRouter(admin)).use(rolesRouter(admin))
}

function request(path: string, token?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

describe('admin membership routes', () => {
  test('refuses an unauthenticated request', async () => {
    const response = await app(dependencies()).handle(
      request(`/v1/admin/organisations/${ORGANISATION_ID}/memberships`),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })

  test('resolves the session before the controller runs', async () => {
    const response = await app(
      dependencies({ authorize: async () => Promise.reject(forbidden()) }),
    ).handle(
      request(`/v1/admin/organisations/${ORGANISATION_ID}/memberships`, TOKEN),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  test('serves the role catalogue on its own path', async () => {
    const response = await app(
      dependencies({ authorize: async () => Promise.reject(forbidden()) }),
    ).handle(request(`/v1/admin/organisations/${ORGANISATION_ID}/roles`, TOKEN))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})
