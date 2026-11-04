import { describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import type { AuditEvent, AuditSink } from '../../src/shared/audit-writer'
import type { AppUser } from '../../src/repositories/app-user-repository'
import type { AdminRequestContext } from '../../src/guards/admin-context'
import type { OrganisationIdentity } from '../../src/controllers/admin/dependencies'
import {
  createOnboarding,
  type OnboardingDependencies,
} from '../../src/controllers/onboarding/create-onboarding'
import { withTransaction } from '../../src/db/pool'

const USER_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ROLE_ID = '66666666-6666-4666-8666-666666666666'
const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777'
const NOW = new Date('2026-11-05T10:00:00.000Z')

const actor: AppUser = {
  id: USER_ID,
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

const context: AdminRequestContext = {
  actor,
  sessionId: 'session-1',
  requestId: 'request-1',
  ip: null,
  userAgentHash: null,
}

interface Call {
  readonly text: string
  readonly values: readonly unknown[]
}

function fakePool(respond: (text: string) => readonly unknown[]) {
  const calls: Call[] = []
  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values: values ?? [] })
    // Transaction control is the pool's job, not the query under test.
    if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [] }
    return { rows: respond(text) }
  }
  const client = { query, release: () => {} }
  const pool = new Pool()
  Object.defineProperty(pool, 'query', { value: query })
  Object.defineProperty(pool, 'connect', { value: async () => client })
  Object.defineProperty(pool, 'end', { value: async () => {} })
  return { pool, calls }
}

function organisationRow(status: 'pending' | 'active') {
  return {
    id: ORG_ID,
    zitadel_org_id: status === 'active' ? 'zitadel-org-1' : null,
    name: 'Clinic One',
    slug: 'clinic-one',
    status,
    provisioned_at: status === 'active' ? NOW : null,
    created_at: NOW,
  }
}

function harness(respond: (text: string) => readonly unknown[]) {
  const { pool, calls } = fakePool(respond)
  const identityCalls: string[] = []
  const auditWrites: AuditEvent[] = []
  const audit: AuditSink = {
    async write(event) {
      auditWrites.push(event)
    },
  }
  const organisationIdentity: OrganisationIdentity = {
    async create(name) {
      identityCalls.push(name)
      return 'zitadel-org-1'
    },
  }
  const dependencies: OnboardingDependencies = {
    db: pool,
    transaction: (run) => withTransaction(pool, run),
    audit,
    organisationIdentity,
  }
  return { dependencies, calls, identityCalls, auditWrites }
}

function standardResponses(text: string): readonly unknown[] {
  if (text.includes('pg_advisory_xact_lock')) return []
  if (text.includes('from control.organisation') && text.includes('where slug =')) return []
  if (text.includes('insert into control.organisation')) return [organisationRow('pending')]
  if (text.includes('instantiate_role_template')) return [{ role_id: ROLE_ID }]
  if (text.includes('update control.organisation')) return [organisationRow('active')]
  if (text.includes('select 1 from control.membership')) return []
  if (text.includes('count(*)')) return [{ count: 0 }]
  if (text.includes('insert into control.membership') && text.includes('returning id')) {
    return [{ id: MEMBERSHIP_ID }]
  }
  if (text.includes('insert into control.membership_role')) return []
  if (text.includes('update identity.app_user')) return []
  if (text.includes('insert into audit.event')) return []
  throw new Error('unexpected query: ' + text)
}

describe('create onboarding', () => {
  test('rejects a blank organisation name before touching the database', async () => {
    const { dependencies, calls, identityCalls, auditWrites } = harness(() => [])

    await expect(
      createOnboarding(dependencies, context, { name: '   ', slug: 'clinic-one' }),
    ).rejects.toMatchObject({ code: 'RULE_VIOLATION', status: 422 })

    expect(identityCalls).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(auditWrites).toHaveLength(0)
  })

  test('rejects a reserved organisation address', async () => {
    const { dependencies, calls, identityCalls } = harness(() => [])

    await expect(
      createOnboarding(dependencies, context, { name: 'Admin', slug: 'admin' }),
    ).rejects.toMatchObject({ code: 'RULE_VIOLATION', status: 422 })

    expect(identityCalls).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  test('an account that already has access is refused before provisioning', async () => {
    const { dependencies, calls, identityCalls, auditWrites } = harness((text) => {
      if (text.includes('select 1 from control.membership')) return [{ present: 1 }]
      throw new Error('unexpected query: ' + text)
    })

    await expect(
      createOnboarding(dependencies, context, { name: 'Clinic One', slug: 'clinic-one' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(identityCalls).toHaveLength(0)
    expect(calls.map((call) => call.text).some((text) => text === 'begin')).toBe(false)
    expect(auditWrites).toHaveLength(0)
  })

  test('provisions the organisation and records the membership in one transaction', async () => {
    const { dependencies, calls, identityCalls, auditWrites } = harness(standardResponses)

    const result = await createOnboarding(dependencies, context, {
      name: '  Clinic   One ',
      slug: ' Clinic-One ',
    })

    expect(result).toEqual({
      id: ORG_ID,
      name: 'Clinic One',
      slug: 'clinic-one',
      status: 'active',
    })
    expect(identityCalls).toEqual(['Clinic One'])

    const statements = calls.map((call) => call.text)
    expect(statements).toContain('begin')
    expect(statements).toContain('commit')
    expect(statements.indexOf('begin')).toBeLessThan(
      statements.findIndex((text) => text.includes('instantiate_role_template')),
    )
    expect(statements.filter((text) => text === 'begin')).toHaveLength(2)

    const membership = auditWrites.find((event) => event.reasonCode === 'membership.onboard')
    expect(membership).toMatchObject({
      actorUserId: USER_ID,
      eventType: 'membership.change',
      reason: 'first organisation',
      targetType: 'membership',
      targetId: MEMBERSHIP_ID,
      organisationId: ORG_ID,
      hospitalId: null,
      metadata: {
        membership_id: MEMBERSHIP_ID,
        from_status: 'none',
        to_status: 'active',
      },
    })
  })
})