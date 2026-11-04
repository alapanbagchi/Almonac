import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import { adminContextOf, adminGuard } from '../../src/guards/admin-context'
import type { AppUser } from '../../src/repositories/app-user-repository'
import type { WebSession } from '../../src/repositories/session-repository'

const token = 'a'.repeat(43)
const at = new Date('2026-01-01T00:00:00Z')

const user: AppUser = {
  id: 'user-1',
  identityIssuer: 'https://issuer.test',
  zitadelSubject: 'subject-1',
  email: 'admin@example.test',
  emailVerifiedAt: at,
  displayName: 'Admin',
  homeOrganisationId: null,
  status: 'active',
  createdAt: at,
  updatedAt: at,
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
  authTime: at,
  aal: 2,
  createdAt: at,
  lastSeenAt: at,
  idleExpiresAt: new Date('2026-01-01T01:00:00Z'),
  absoluteExpiresAt: new Date('2026-01-02T00:00:00Z'),
  revokedAt: null,
  revokeReason: null,
  ip: null,
  userAgentHash: null,
}

const dependencies: AdminDependencies = {
  db: { query: async () => ({ rows: [] }) },
  transaction: (run) => run({ query: async () => ({ rows: [] }) }),
  authorize: async () => undefined,
  permissions: async () => [],
  isPlatformAdmin: async () => false,
  audit: { write: async () => undefined },
  sessions: { authenticate: async () => session, revoke: async () => true },
  users: { findById: async () => user },
  organisationIdentity: {
    create: async () => {
      throw new Error('the identity provider must not be called')
    },
  },
}

/** A route registered after the guard, the way every slice router mounts it. */
function probe() {
  return new Elysia().use(adminGuard(dependencies)).get('/probe', (context) => ({
    actor: adminContextOf(context).actor.id,
  }))
}

describe('adminGuard', () => {
  it('resolves the actor for routes registered after the guard', async () => {
    const response = await probe().handle(
      new Request('http://test/probe', {
        headers: { authorization: 'Bearer ' + token },
      }),
    )
    expect(await response.json()).toEqual({ actor: 'user-1' })
  })

  it('rejects a request with no bearer token', async () => {
    const response = await probe().handle(new Request('http://test/probe'))
    expect(response.status).toBe(401)
  })
})
