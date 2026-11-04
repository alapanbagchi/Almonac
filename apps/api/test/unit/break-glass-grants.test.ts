import { describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import type { AuditEvent, AuditSink } from '../../src/audit/audit-writer'
import { AppError } from '../../src/shared/errors'
import type { AppUser } from '../../src/identity/app-user-repository'
import { activateGrant } from '../../src/controllers/break-glass/activate-grant'
import { requestGrant } from '../../src/controllers/break-glass/request-grant'
import {
  type BreakGlassContext,
  type BreakGlassDependencies,
} from '../../src/controllers/break-glass/support'

const GRANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const HOSPITAL_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_ID = '55555555-5555-4555-8555-555555555555'
const NOW = new Date('2026-11-05T10:00:00.000Z')

const actor: AppUser = {
  id: ACTOR_ID,
  identityIssuer: 'https://identity.example.test',
  zitadelSubject: 'subject-1',
  email: 'actor@example.test',
  emailVerifiedAt: NOW,
  displayName: 'Actor',
  homeOrganisationId: null,
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
  lastLoginAt: null,
}

const context: BreakGlassContext = {
  actor,
  sessionId: 'session-1',
  aal: 2,
  amr: ['password', 'totp'],
  authTime: new Date(NOW.getTime() - 60_000),
  requestId: 'request-1',
  ip: null,
  userAgentHash: null,
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    organisation_id: ORG_ID,
    hospital_id: HOSPITAL_ID,
    user_id: ACTOR_ID,
    approved_by: null,
    approval_mode: 'emergency',
    reason: 'Cardiac arrest',
    access_level: 'read_only',
    status: 'active',
    starts_at: NOW,
    ends_at: new Date(NOW.getTime() + 60 * 60_000),
    approved_at: NOW,
    activated_at: NOW,
    activated_by: ACTOR_ID,
    revoked_at: null,
    expired_at: null,
    created_at: NOW,
    ...overrides,
  }
}

const hospitalRow = {
  id: HOSPITAL_ID,
  organisation_id: ORG_ID,
  name: 'General Hospital',
  status: 'active',
}

interface Call {
  readonly text: string
  readonly values: readonly unknown[]
}

function fakePool(respond: (text: string, values: readonly unknown[]) => readonly unknown[]) {
  const calls: Call[] = []
  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values: values ?? [] })
    // Transaction control is the pool's job, not the query under test.
    if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [] }
    return { rows: respond(text, values ?? []) }
  }
  const client = { query, release: () => {} }
  const pool = new Pool()
  Object.defineProperty(pool, 'query', { value: query })
  Object.defineProperty(pool, 'connect', { value: async () => client })
  Object.defineProperty(pool, 'end', { value: async () => {} })
  return { pool, calls }
}

function fakeAudit() {
  const writes: AuditEvent[] = []
  const audit: AuditSink = {
    async write(event) {
      writes.push(event)
    },
  }
  return { audit, writes }
}

function dependencies(
  pool: Pool,
  audit: AuditSink,
  overrides: Partial<BreakGlassDependencies> = {},
): BreakGlassDependencies {
  return {
    pool,
    authorize: async () => {},
    hasAnyPlatformPermission: async () => false,
    users: { findById: async () => null },
    audit,
    clock: () => NOW,
    ...overrides,
  }
}

function isTransactionStart(text: string) {
  return text === 'begin'
}

describe('break-glass grant controllers', () => {
  test('a requester without permission never writes an emergency grant', async () => {
    const { pool, calls } = fakePool((text) => {
      if (text.includes('from control.hospital')) return [hospitalRow]
      throw new Error('unexpected query: ' + text)
    })
    const { audit, writes } = fakeAudit()
    const deps = dependencies(pool, audit, {
      authorize: async () => {
        throw new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
      },
    })

    await expect(
      requestGrant(deps, context, {
        hospitalId: HOSPITAL_ID,
        mode: 'emergency',
        reason: 'Cardiac arrest',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })

    expect(calls.map((call) => call.text)).not.toContain('begin')
    expect(writes).toHaveLength(0)
  })

  test('another person cannot activate a pre-approved grant', async () => {
    const { pool, calls } = fakePool((text) => {
      if (text.includes('from control.break_glass_grant')) {
        return [grantRow({ user_id: OTHER_ID, status: 'approved' })]
      }
      throw new Error('unexpected query: ' + text)
    })
    const { audit, writes } = fakeAudit()

    await expect(
      activateGrant(dependencies(pool, audit), context, GRANT_ID),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })

    const statements = calls.map((call) => call.text)
    expect(statements.some((text) => text.startsWith('update'))).toBe(false)
    expect(statements.some(isTransactionStart)).toBe(false)
    expect(writes).toHaveLength(0)
  })

  test('an approver cannot approve their own emergency access', async () => {
    const { pool, calls } = fakePool(() => {
      throw new Error('no query expected before the self-approval check')
    })
    const { audit, writes } = fakeAudit()
    const deps = dependencies(pool, audit, { hasAnyPlatformPermission: async () => true })

    await expect(
      requestGrant(deps, context, {
        hospitalId: HOSPITAL_ID,
        mode: 'pre_approved',
        reason: 'Covering the ward',
        userId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'RULE_VIOLATION', status: 422 })

    expect(calls).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  test('an emergency request writes the grant and its audit in one transaction', async () => {
    const { pool, calls } = fakePool((text) => {
      if (text.includes('insert into control.break_glass_grant')) return [grantRow()]
      if (text.includes('insert into audit.event')) return []
      if (text.includes('from control.hospital')) return [hospitalRow]
      if (text.includes('from control.membership')) return [{ present: 1 }]
      if (text.includes('from control.break_glass_grant')) return []
      throw new Error('unexpected query: ' + text)
    })
    const { audit, writes } = fakeAudit()

    const grant = await requestGrant(dependencies(pool, audit), context, {
      hospitalId: HOSPITAL_ID,
      mode: 'emergency',
      reason: '  Cardiac arrest  ',
    })

    expect(grant).toMatchObject({
      id: GRANT_ID,
      status: 'active',
      approvalMode: 'emergency',
      startsAt: NOW.toISOString(),
      endsAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
    })
    const statements = calls.map((call) => call.text)
    expect(statements).toContain('begin')
    expect(statements).toContain('commit')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      actorUserId: ACTOR_ID,
      eventType: 'break_glass.activate',
      reasonCode: 'break_glass.emergency',
      targetType: 'break_glass_grant',
      targetId: GRANT_ID,
      organisationId: ORG_ID,
      hospitalId: HOSPITAL_ID,
      metadata: { grant_id: GRANT_ID },
    })
  })
})
