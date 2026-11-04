import { describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import { createInvitation } from '../../src/controllers/admin/invitations/create-invitation'
import {
  revokePendingInvitation,
  type InvitationDependencies,
  type InvitationMailer,
} from '../../src/controllers/admin/invitations/issue'
import { listInvitations } from '../../src/controllers/admin/invitations/list-invitations'
import type { AdminRequestContext } from '../../src/guards/admin-context'
import type { AppUser } from '../../src/identity/app-user-repository'
import type { Invitation } from '../../src/repositories/invitation-repository'
import type { AuditEvent } from '../../src/audit/audit-writer'
import { withTransaction, type DatabaseQuery } from '../../src/db/pool'
import { AppError, forbidden } from '../../src/shared/errors'

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222'

function unusedPool(): Pool {
  return new Pool({
    host: '127.0.0.1',
    port: 1,
    database: 'unused',
    user: 'unused',
    password: 'unused',
    max: 1,
  })
}

function context(): AdminRequestContext {
  const user: AppUser = {
    id: '66666666-6666-4666-8666-666666666666',
    identityIssuer: 'https://issuer.example',
    zitadelSubject: 'subject-1',
    email: 'person@example.com',
    emailVerifiedAt: null,
    displayName: 'Person',
    homeOrganisationId: null,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: null,
  }
  return { actor: user, sessionId: 'session-1', requestId: 'request-1', ip: null, userAgentHash: null }
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'person@example.com',
    organisationId: ORGANISATION_ID,
    hospitalId: null,
    kind: 'existing_user',
    zitadelSub: 'subject-1',
    status: 'pending',
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    acceptedAt: null,
    acceptedByUserId: null,
    invitedBy: '33333333-3333-4333-8333-333333333333',
    roleIds: ['44444444-4444-4444-8444-444444444444'],
    ...overrides,
  }
}

interface Recorded {
  readonly events: AuditEvent[]
  readonly mails: { sent: number }
}

function dependencies(pool: Pool, authorize: AdminDependencies['authorize']): InvitationDependencies & Recorded {
  const events: AuditEvent[] = []
  const mails = { sent: 0 }
  const mailer: InvitationMailer = {
    async send() {
      mails.sent += 1
    },
  }
  return {
    events,
    mails,
    db: pool,
    transaction: (run) => withTransaction(pool, run),
    organisationIdentity: {
      async create() {
        throw new Error('the identity provider must not be reached')
      },
    },
    authorize,
    permissions: async () => [],
    isPlatformAdmin: async () => false,
    audit: {
      async write(event) {
        events.push(event)
      },
    },
    sessions: { authenticate: async () => null, revoke: async () => false },
    users: { findById: async () => null },
    mailer,
    identity: {
      createHumanUser: async () => 'subject-new',
      resendInitialization: async () => undefined,
      deactivateUser: async () => undefined,
    },
  }
}

describe('invitation controller authorisation', () => {
  test('a forbidden reader is refused before any query runs', async () => {
    const pool = unusedPool()
    const recorded = dependencies(pool, async () => {
      throw forbidden()
    })

    const failure = await listInvitations(recorded, context(), {
      organisationId: ORGANISATION_ID,
      hospitalId: null,
    }).then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(AppError)
    expect(failure).toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(pool.totalCount).toBe(0)
    expect(recorded.events).toHaveLength(0)
    await pool.end()
  })

  test('an invalid address is rejected before the organisation is even loaded', async () => {
    const pool = unusedPool()
    const recorded = dependencies(pool, async () => undefined)

    const failure = await createInvitation(recorded, context(), {
      email: 'not-an-address',
      organisationId: ORGANISATION_ID,
      hospitalId: null,
      roleIds: ['44444444-4444-4444-8444-444444444444'],
    }).then(() => null, (error: unknown) => error)

    expect(failure).toMatchObject({ status: 422, message: 'Email address is not valid.' })
    expect(pool.totalCount).toBe(0)
    expect(recorded.events).toHaveLength(0)
    await pool.end()
  })
})

describe('revoking an invitation that is no longer pending', () => {
  function updateMisses(): DatabaseQuery {
    return {
      async query() {
        return { rows: [] }
      },
    }
  }

  test('refuses the revocation and writes no audit row', async () => {
    const pool = unusedPool()
    const recorded = dependencies(pool, async () => undefined)

    const failure = await revokePendingInvitation(
      recorded,
      context(),
      updateMisses(),
      invitation(),
    ).then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(AppError)
    expect(failure).toMatchObject({ code: 'CONFLICT', message: 'Invitation is no longer pending.' })
    expect(recorded.events).toHaveLength(0)
    await pool.end()
  })

  test('audits the revocation inside the caller transaction', async () => {
    const pool = unusedPool()
    const recorded = dependencies(pool, async () => undefined)
    const db: DatabaseQuery = {
      async query() {
        return { rows: [{ id: invitation().id }] }
      },
    }

    await revokePendingInvitation(recorded, context(), db, invitation())

    expect(recorded.events).toHaveLength(1)
    expect(recorded.events[0]).toMatchObject({
      actorUserId: context().actor.id,
      organisationId: ORGANISATION_ID,
      hospitalId: null,
      eventType: 'admin.change',
      outcome: 'success',
      targetType: 'invitation',
      targetId: invitation().id,
      reasonCode: 'invitation.revoked',
    })
    await pool.end()
  })
})
