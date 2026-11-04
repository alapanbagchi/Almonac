import { describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import type { AuditEvent } from '../../src/shared/audit-writer'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import { assignRole } from '../../src/controllers/admin/memberships/assign-role'
import { revokeMembership } from '../../src/controllers/admin/memberships/revoke-membership'
import { revokeRole } from '../../src/controllers/admin/memberships/revoke-role'
import { suspendMembership } from '../../src/controllers/admin/memberships/suspend-membership'
import { withTransaction } from '../../src/db/pool'
import type { AdminRequestContext } from '../../src/guards/admin-context'
import type { AppUser } from '../../src/repositories/app-user-repository'
import { AppError, forbidden } from '../../src/shared/errors'

const ORGANISATION_ID = '11111111-1111-4111-8111-111111111111'
const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const ROLE_ID = '55555555-5555-4555-8555-555555555555'

interface Statement {
  readonly sql: string
  readonly values: readonly unknown[]
}

type Handler = (sql: string, values: readonly unknown[]) => readonly unknown[]

/** A Pool whose only live behaviour is answering queries from the test. */
function fakePool(handler: Handler): {
  pool: Pool
  statements: Statement[]
  connects: () => number
} {
  const statements: Statement[] = []
  let connections = 0
  const pool = new Pool()
  const answer = async (sql: string, values?: readonly unknown[]) => {
    const bound = values ?? []
    statements.push({ sql, values: bound })
    return { rows: handler(sql, bound) }
  }
  const client = { query: answer, release: () => undefined }

  Object.defineProperty(pool, 'query', { value: answer })
  Object.defineProperty(pool, 'connect', {
    value: async () => {
      connections += 1
      return client
    },
  })

  return { pool, statements, connects: () => connections }
}

function actor(): AppUser {
  return {
    id: ACTOR_ID,
    identityIssuer: 'https://issuer.example.test',
    zitadelSubject: 'subject-1',
    email: 'actor@example.test',
    emailVerifiedAt: new Date('2025-01-01T00:00:00.000Z'),
    displayName: 'Actor',
    homeOrganisationId: ORGANISATION_ID,
    status: 'active',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    lastLoginAt: null,
  }
}

function context(): AdminRequestContext {
  return {
    actor: actor(),
    sessionId: '66666666-6666-4666-8666-666666666666',
    requestId: 'request-1',
    ip: null,
    userAgentHash: null,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEMBERSHIP_ID,
    user_id: USER_ID,
    email: 'member@example.test',
    display_name: 'Member',
    organisation_id: ORGANISATION_ID,
    hospital_id: null,
    status: 'active',
    accepted_at: new Date('2025-01-02T00:00:00.000Z'),
    ends_at: null,
    roles: [],
    ...overrides,
  }
}

function roleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROLE_ID,
    key: 'organisation_administrator',
    name: 'Organisation administrator',
    scope: 'organisation',
    permissions: ['organisation.manage'],
    ...overrides,
  }
}

interface Setup {
  readonly dependencies: AdminDependencies
  readonly statements: Statement[]
  readonly events: AuditEvent[]
  readonly connects: () => number
  readonly writes: () => Statement[]
}

function setup(
  handler: Handler,
  options: {
    authorize?: AdminDependencies['authorize']
    permissions?: AdminDependencies['permissions']
    isPlatformAdmin?: AdminDependencies['isPlatformAdmin']
  } = {},
): Setup {
  const pool = fakePool(handler)
  const events: AuditEvent[] = []
  const dependencies: AdminDependencies = {
    db: pool.pool,
    transaction: (run) => withTransaction(pool.pool, run),
    authorize: options.authorize ?? (async () => undefined),
    permissions: options.permissions ?? (async () => []),
    isPlatformAdmin: options.isPlatformAdmin ?? (async () => false),
    audit: {
      async write(event) {
        events.push(event)
      },
    },
    sessions: {
      async authenticate() {
        return null
      },
      async revoke() {
        return false
      },
    },
    users: {
      async findById() {
        return null
      },
    },
    organisationIdentity: {
      create: async () => {
        throw new Error('the identity provider must not be called')
      },
    },
  }

  return {
    dependencies,
    statements: pool.statements,
    events,
    connects: pool.connects,
    writes: () =>
      pool.statements.filter((statement) => /^\s*(insert|update)/i.test(statement.sql)),
  }
}

/** Every read the controllers issue, answered from one membership and one role. */
function store(options: { count?: number; membership?: Record<string, unknown>; role?: Record<string, unknown> } = {}): Handler {
  return (sql) => {
    if (sql.includes('count(distinct membership.id)')) return [{ count: options.count ?? 2 }]
    if (sql.includes('from control.role as role')) return [options.role ?? roleRow()]
    if (sql.includes('from control.membership as membership')) {
      return [options.membership ?? membershipRow()]
    }
    if (/^\s*(insert into|update)/i.test(sql)) return [{ id: 'written' }]
    return []
  }
}

async function failure(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('membership suspension', () => {
  test('suspends an active membership and records the change in the same transaction', async () => {
    const s = setup(store())

    await suspendMembership(s.dependencies, context(), MEMBERSHIP_ID, 'policy breach')

    expect(s.connects()).toBe(1)
    expect(s.statements.map((statement) => statement.sql.trim().split(/\s+/)[0])).toContain('begin')
    expect(s.writes()).toHaveLength(1)
    expect(s.events).toHaveLength(1)
    expect(s.events[0]).toMatchObject({
      eventType: 'membership.change',
      reasonCode: 'membership.suspended',
      reason: 'policy breach',
      targetType: 'membership',
      targetId: MEMBERSHIP_ID,
      metadata: { membership_id: MEMBERSHIP_ID, from_status: 'active', to_status: 'suspended' },
    })
  })

  test('a forbidden actor is refused before any write', async () => {
    const s = setup(store(), { authorize: async () => Promise.reject(forbidden()) })

    const error = await failure(() =>
      suspendMembership(s.dependencies, context(), MEMBERSHIP_ID, 'policy breach'),
    )

    expect(error.code).toBe('FORBIDDEN')
    expect(s.connects()).toBe(0)
    expect(s.writes()).toEqual([])
    expect(s.events).toEqual([])
  })
})

describe('membership revocation', () => {
  test('refuses to let an administrator revoke their own access without writing', async () => {
    const s = setup(store({ membership: membershipRow({ user_id: ACTOR_ID }) }))

    const error = await failure(() =>
      revokeMembership(s.dependencies, context(), MEMBERSHIP_ID, 'leaving'),
    )

    expect(error.message).toBe('You cannot revoke your own access.')
    expect(error.code).toBe('CONFLICT')
    expect(s.connects()).toBe(0)
    expect(s.writes()).toEqual([])
    expect(s.events).toEqual([])
  })

  test('refuses to remove the last organisation administrator without writing', async () => {
    const s = setup(store({ count: 1 }))

    const error = await failure(() =>
      revokeMembership(s.dependencies, context(), MEMBERSHIP_ID, 'cleanup'),
    )

    expect(error.message).toBe('The last organisation administrator cannot be removed.')
    expect(s.connects()).toBe(0)
    expect(s.writes()).toEqual([])
    expect(s.events).toEqual([])
  })
})

describe('role assignment', () => {
  test('assigns a role that matches the membership scope and audits it', async () => {
    const s = setup(store(), { permissions: async () => ['organisation.manage'] })

    await assignRole(s.dependencies, context(), MEMBERSHIP_ID, ROLE_ID)

    expect(s.writes()).toHaveLength(1)
    expect(s.events[0]).toMatchObject({
      eventType: 'role.assign',
      reasonCode: 'role.assigned',
      metadata: { membership_id: MEMBERSHIP_ID, role_id: ROLE_ID },
    })
  })

  test('refuses a role from a different scope without writing', async () => {
    const s = setup(store({ role: roleRow({ scope: 'hospital' }) }))

    const error = await failure(() =>
      assignRole(s.dependencies, context(), MEMBERSHIP_ID, ROLE_ID),
    )

    expect(error.message).toBe('Role scope does not match the membership.')
    expect(s.connects()).toBe(0)
    expect(s.writes()).toEqual([])
  })

  test('refuses a permission the actor does not hold without writing', async () => {
    const s = setup(store(), { permissions: async () => ['membership.manage'] })

    const error = await failure(() =>
      assignRole(s.dependencies, context(), MEMBERSHIP_ID, ROLE_ID),
    )

    expect(error.code).toBe('FORBIDDEN')
    expect(s.connects()).toBe(0)
    expect(s.writes()).toEqual([])
  })

  test('a platform administrator may grant any role', async () => {
    const s = setup(store(), { isPlatformAdmin: async () => true })

    await assignRole(s.dependencies, context(), MEMBERSHIP_ID, ROLE_ID)

    expect(s.writes()).toHaveLength(1)
  })
})

describe('role revocation', () => {
  test('refuses to remove the last organisation administrator role without writing', async () => {
    const s = setup(store({ count: 1 }))

    const error = await failure(() =>
      revokeRole(s.dependencies, context(), MEMBERSHIP_ID, ROLE_ID),
    )

    expect(error.message).toBe('The last organisation administrator cannot be removed.')
    expect(s.connects()).toBe(0)
    expect(s.writes()).toEqual([])
    expect(s.events).toEqual([])
  })
})
