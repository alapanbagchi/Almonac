import { describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import { parseAuditCursor } from '../../src/controllers/admin/audit/cursor'
import { auditResponse, listAudit } from '../../src/controllers/admin/audit/list-audit'
import type { AdminRequestContext } from '../../src/guards/admin-context'
import type { AppUser } from '../../src/identity/app-user-repository'
import type { AuditEntry } from '../../src/repositories/audit-repository'
import { AppError, forbidden } from '../../src/shared/errors'

const VALID = '2026-11-04T16:25:51.742539Z:42'

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
  return {
    actor: user,
    sessionId: 'session-1',
    requestId: 'request-1',
    ip: null,
    userAgentHash: null,
  }
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: '9',
    occurredAt: new Date('2026-11-04T16:25:51.742Z'),
    actorType: 'user',
    actorUserId: '66666666-6666-4666-8666-666666666666',
    sessionId: 'session-1',
    organisationId: '22222222-2222-4222-8222-222222222222',
    hospitalId: null,
    eventType: 'admin.change',
    outcome: 'success',
    targetType: 'invitation',
    targetId: '11111111-1111-4111-8111-111111111111',
    requestId: 'request-1',
    reasonCode: 'invitation.revoked',
    metadata: { resource_id: '11111111-1111-4111-8111-111111111111' },
    ...overrides,
  }
}

describe('audit cursor parsing', () => {
  test('accepts an absent cursor and keeps microsecond precision', () => {
    expect(parseAuditCursor(undefined)).toBeNull()
    expect(parseAuditCursor(VALID)).toEqual({
      occurredAt: '2026-11-04T16:25:51.742539Z',
      id: '42',
    })
  })

  test.each([
    '',
    'not-a-cursor',
    '2026-11-04T16:25:51.742539Z',
    '2026-11-04T16:25:51.742539Z:',
    '2026-11-04T16:25:51.742539Z:0',
    '2026-11-04T16:25:51.742539Z:01',
    '2026-11-04T16:25:51.742539Z:1234567890123456789',
    '2026-11-04T16:25:51.742539:42',
    '2026-02-30T16:25:51.742539Z:42',
  ])('rejects %s', (value) => {
    try {
      parseAuditCursor(value)
      throw new Error('expected the cursor to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    }
  })
})

describe('audit response', () => {
  test('publishes instants and never the paging cursor', () => {
    const response = auditResponse(entry())

    expect(response.occurredAt).toBe('2026-11-04T16:25:51.742Z')
    expect(Object.keys(response)).not.toContain('cursor')
    expect(response.metadata).toEqual({
      resource_id: '11111111-1111-4111-8111-111111111111',
    })
  })
})

describe('audit list authorisation', () => {
  test('a forbidden reader is refused before any query runs', async () => {
    const pool = new Pool({
      host: '127.0.0.1',
      port: 1,
      database: 'unused',
      user: 'unused',
      password: 'unused',
      max: 1,
    })
    let auditWrites = 0
    const target: { organisationId?: string; hospitalId?: string | null } = {}
    const dependencies: AdminDependencies = {
      pool,
      async authorize(_actorId, _permission, requested) {
        target.organisationId = requested.organisationId
        target.hospitalId = requested.hospitalId
        throw forbidden()
      },
      permissions: async () => [],
      isPlatformAdmin: async () => false,
      audit: {
        async write() {
          auditWrites += 1
        },
      },
      sessions: {
        authenticate: async () => null,
        revoke: async () => false,
      },
      users: {
        findById: async () => null,
      },
    }

    const failure = await listAudit(dependencies, context(), {
      organisationId: '22222222-2222-4222-8222-222222222222',
      hospitalId: null,
    }).then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(AppError)
    expect(failure).toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(target).toEqual({
      organisationId: '22222222-2222-4222-8222-222222222222',
      hospitalId: null,
    })
    expect(pool.totalCount).toBe(0)
    expect(auditWrites).toBe(0)
    await pool.end()
  })
})
