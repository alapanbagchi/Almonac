import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { Pool } from 'pg'
import type { AuditEvent, AuditSink } from '../../src/shared/audit-writer'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import { addDomain } from '../../src/controllers/admin/hospitals/add-domain'
import { createHospital } from '../../src/controllers/admin/hospitals/create-hospital'
import { listDomains } from '../../src/controllers/admin/hospitals/list-domains'
import { listHospitals } from '../../src/controllers/admin/hospitals/list-hospitals'
import { setPrimaryDomain } from '../../src/controllers/admin/hospitals/set-primary-domain'
import { verifyDomain } from '../../src/controllers/admin/hospitals/verify-domain'
import { withTransaction } from '../../src/db/pool'
import type { AdminRequestContext } from '../../src/guards/admin-context'
import type { AppUser } from '../../src/repositories/app-user-repository'
import type { WebSession } from '../../src/repositories/session-repository'
import { errors } from '../../src/plugins/errors'
import { hospitalsRouter } from '../../src/routes/hospitals.router'
import type { AccessTarget } from '../../src/shared/access-target'
import { AppError } from '../../src/shared/errors'
import { hashToken } from '../../src/shared/tokens'

const ORGANISATION_ID = '11111111-1111-4111-8111-111111111111'
const HOSPITAL_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_HOSPITAL_ID = '66666666-6666-4666-8666-666666666666'
const DOMAIN_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const SESSION_ID = '55555555-5555-4555-8555-555555555555'
const SESSION_TOKEN = 'a'.repeat(43)
const CREATED_AT = new Date('2026-11-05T00:00:00.000Z')
const VERIFIED_AT = new Date('2026-11-05T01:00:00.000Z')

const actor: AppUser = {
  id: ACTOR_ID,
  identityIssuer: 'https://identity.example',
  zitadelSubject: 'subject-1',
  email: 'admin@example.com',
  emailVerifiedAt: CREATED_AT,
  displayName: 'Admin',
  homeOrganisationId: ORGANISATION_ID,
  status: 'active',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  lastLoginAt: null,
}

const session: WebSession = {
  id: SESSION_ID,
  userId: ACTOR_ID,
  identityIssuer: 'https://identity.example',
  tokenHash: Buffer.alloc(32),
  zitadelSessionId: null,
  oidcSid: null,
  acr: null,
  idTokenHintCiphertext: null,
  keyVersion: null,
  amr: [],
  authTime: CREATED_AT,
  aal: 2,
  createdAt: CREATED_AT,
  lastSeenAt: CREATED_AT,
  idleExpiresAt: CREATED_AT,
  absoluteExpiresAt: CREATED_AT,
  revokedAt: null,
  revokeReason: null,
  ip: null,
  userAgentHash: null,
}

const context: AdminRequestContext = {
  actor,
  sessionId: SESSION_ID,
  requestId: 'request-1',
  ip: null,
  userAgentHash: null,
}

type QueryHandler = (text: string, values: readonly unknown[]) => readonly unknown[]

interface QueryRecord {
  readonly text: string
  readonly values: readonly unknown[]
}

interface FakePool {
  readonly pool: Pool
  readonly queries: QueryRecord[]
}

/** A Pool facade that answers queries from memory and never connects anywhere. */
function fakePool(handler: QueryHandler = () => []): FakePool {
  const queries: QueryRecord[] = []
  const respond = (text: string, values: readonly unknown[]) => {
    queries.push({ text, values })
    return text === 'begin' || text === 'commit' || text === 'rollback' ? [] : handler(text, values)
  }
  const client = {
    async query(text: string, values: unknown[] = []) {
      return { rows: respond(text, values) }
    },
    release() {},
  }
  const pool: Pool = Object.assign({} as Pool, {
    async query(text: string, values: unknown[] = []) {
      return { rows: respond(text, values) }
    },
    async connect() {
      return client
    },
  })
  return { pool, queries }
}

interface RecordedAudit {
  readonly event: AuditEvent
  readonly db: unknown
}

function recordingAudit(): { readonly audit: AuditSink; readonly recorded: RecordedAudit[] } {
  const recorded: RecordedAudit[] = []
  return {
    audit: {
      write: async (event, db) => {
        recorded.push({ event, db })
      },
    },
    recorded,
  }
}

function dependencies(options: {
  readonly pool?: Pool
  readonly authorize?: AdminDependencies['authorize']
  readonly audit?: AuditSink
} = {}): AdminDependencies {
  const pool = options.pool ?? fakePool().pool
  return {
    db: pool,
    transaction: (run) => withTransaction(pool, run),
    authorize: options.authorize ?? (async () => {}),
    permissions: async () => [],
    isPlatformAdmin: async () => false,
    audit: options.audit ?? { write: async () => {} },
    sessions: { authenticate: async () => session, revoke: async () => true },
    users: { findById: async () => actor },
    organisationIdentity: {
      create: async () => {
        throw new Error('the identity provider must not be called')
      },
    },
  }
}

function hospitalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: HOSPITAL_ID,
    organisation_id: ORGANISATION_ID,
    name: 'General Hospital',
    slug: 'general-hospital',
    timezone: 'UTC',
    status: 'pending',
    primary_domain_id: null,
    created_at: CREATED_AT,
    ...overrides,
  }
}

function domainRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DOMAIN_ID,
    hospital_id: HOSPITAL_ID,
    domain: 'hospital.example',
    verified_at: null,
    retired_at: null,
    created_at: CREATED_AT,
    ...overrides,
  }
}

function rowsFor(
  text: string,
  hospital: readonly unknown[],
  domain: readonly unknown[],
): readonly unknown[] {
  if (text.includes('control.hospital_domain')) return domain
  if (text.includes('control.hospital')) return hospital
  return []
}

describe('hospital controllers', () => {
  test('lists hospitals at the organisation scope and maps the page', async () => {
    const checks: { actorId: string; permission: string; target: AccessTarget }[] = []
    const { pool } = fakePool((text) =>
      rowsFor(text, [hospitalRow(), hospitalRow({ id: OTHER_HOSPITAL_ID, name: 'Other', slug: 'other' })], []),
    )
    const page = await listHospitals(
      dependencies({
        pool,
        authorize: async (actorId, permission, target) => {
          checks.push({ actorId, permission, target })
        },
      }),
      context,
      ORGANISATION_ID,
      { limit: 1, offset: 0 },
    )

    expect(checks).toEqual([
      { actorId: ACTOR_ID, permission: 'hospital.manage', target: { organisationId: ORGANISATION_ID } },
    ])
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.createdAt).toBe('2026-11-05T00:00:00.000Z')
    expect(page.nextOffset).toBe(1)
  })

  test('creates a hospital with the default timezone and audits in the transaction', async () => {
    const { pool, queries } = fakePool((text) => rowsFor(text, [hospitalRow()], []))
    const audits = recordingAudit()
    const created = await createHospital(
      dependencies({ pool, audit: audits.audit }),
      context,
      ORGANISATION_ID,
      { name: 'General Hospital', slug: 'general-hospital' },
    )

    const insert = queries.find((query) => query.text.includes('insert into control.hospital ('))
    expect(insert?.values).toEqual([
      ORGANISATION_ID,
      'General Hospital',
      'general-hospital',
      'UTC',
    ])
    expect(created.timezone).toBe('UTC')
    expect(created.createdAt).toBe('2026-11-05T00:00:00.000Z')
    expect(queries[0]?.text).toBe('begin')
    expect(queries.at(-1)?.text).toBe('commit')
    expect(audits.recorded).toHaveLength(1)
    expect(audits.recorded[0]?.event).toMatchObject({
      eventType: 'admin.change',
      reasonCode: 'hospital.created',
      targetType: 'hospital',
      targetId: HOSPITAL_ID,
      organisationId: ORGANISATION_ID,
      hospitalId: HOSPITAL_ID,
    })
    expect(audits.recorded[0]?.db).toBeDefined()
  })

  test('adds a domain, returning the token once and storing only its hash', async () => {
    const { pool, queries } = fakePool((text) => rowsFor(text, [hospitalRow()], [domainRow()]))
    const audits = recordingAudit()
    const added = await addDomain(
      dependencies({ pool, audit: audits.audit }),
      context,
      HOSPITAL_ID,
      'hospital.example',
    )

    const insert = queries.find((query) => query.text.includes('insert into control.hospital_domain'))
    const stored = insert?.values[2]
    if (!Buffer.isBuffer(stored)) throw new Error('the token hash was not stored as bytes')
    expect(stored.length).toBe(32)
    expect(stored.equals(hashToken(added.token))).toBe(true)
    expect(added.token).toHaveLength(43)
    expect(added.domain).toEqual({
      id: DOMAIN_ID,
      hospitalId: HOSPITAL_ID,
      domain: 'hospital.example',
      verifiedAt: null,
      retiredAt: null,
      createdAt: '2026-11-05T00:00:00.000Z',
    })
    expect(audits.recorded[0]?.event).toMatchObject({
      reasonCode: 'hospital.domain_added',
      targetType: 'hospital_domain',
      targetId: DOMAIN_ID,
    })
  })

  test('rejects a verification token that matches no row, without auditing', async () => {
    const { pool, queries } = fakePool((text) => rowsFor(text, [hospitalRow()], []))
    const audits = recordingAudit()

    try {
      await verifyDomain(
        dependencies({ pool, audit: audits.audit }),
        context,
        HOSPITAL_ID,
        DOMAIN_ID,
        'wrong-token',
      )
      throw new Error('expected the verification to fail')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'RULE_VIOLATION',
        status: 422,
        message: 'Domain verification failed.',
      })
    }

    const update = queries.find((query) => query.text.includes('update control.hospital_domain'))
    expect(update?.values[2]).toEqual(hashToken('wrong-token'))
    expect(audits.recorded).toHaveLength(0)
    expect(queries.at(-1)?.text).toBe('rollback')
  })

  test('verifies a domain and audits the change', async () => {
    const { pool } = fakePool((text) =>
      rowsFor(text, [hospitalRow()], [domainRow({ verified_at: VERIFIED_AT })]),
    )
    const audits = recordingAudit()
    const verified = await verifyDomain(
      dependencies({ pool, audit: audits.audit }),
      context,
      HOSPITAL_ID,
      DOMAIN_ID,
      'right-token',
    )

    expect(verified.verifiedAt).toBe('2026-11-05T01:00:00.000Z')
    expect(audits.recorded[0]?.event).toMatchObject({
      reasonCode: 'hospital.domain_verified',
      targetType: 'hospital_domain',
      targetId: DOMAIN_ID,
      hospitalId: HOSPITAL_ID,
    })
  })

  test('sets the primary domain and audits the hospital change', async () => {
    const { pool } = fakePool((text) =>
      rowsFor(text, [hospitalRow({ status: 'active', primary_domain_id: DOMAIN_ID })], []),
    )
    const audits = recordingAudit()
    const hospital = await setPrimaryDomain(
      dependencies({ pool, audit: audits.audit }),
      context,
      HOSPITAL_ID,
      DOMAIN_ID,
    )

    expect(hospital.status).toBe('active')
    expect(hospital.primaryDomainId).toBe(DOMAIN_ID)
    expect(audits.recorded[0]?.event).toMatchObject({
      reasonCode: 'hospital.domain_primary_changed',
      targetType: 'hospital',
      targetId: HOSPITAL_ID,
      organisationId: ORGANISATION_ID,
    })
  })

  test('surfaces the primary-domain trigger as a rule violation', async () => {
    const { pool } = fakePool((text) => {
      if (text.includes('set primary_domain_id')) {
        throw Object.assign(new Error('primary domain must be verified'), { code: '23514' })
      }
      return rowsFor(text, [hospitalRow()], [])
    })

    try {
      await setPrimaryDomain(dependencies({ pool }), context, HOSPITAL_ID, DOMAIN_ID)
      throw new Error('expected the primary domain to be rejected')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'RULE_VIOLATION',
        status: 422,
        message: 'The domain must be verified for this hospital before it becomes primary.',
      })
    }
  })

  test('a client-supplied hospital id never proves access', async () => {
    const { pool, queries } = fakePool((text) => rowsFor(text, [hospitalRow()], []))
    const authorize: AdminDependencies['authorize'] = async (actorId, permission, target) => {
      expect(actorId).toBe(ACTOR_ID)
      expect(permission).toBe('hospital.manage')
      expect(target).toEqual({ organisationId: ORGANISATION_ID, hospitalId: HOSPITAL_ID })
      throw new AppError('FORBIDDEN', 403, 'Not allowed.')
    }

    try {
      await listDomains(dependencies({ pool, authorize }), context, HOSPITAL_ID, {
        limit: 50,
        offset: 0,
      })
      throw new Error('expected the read to be denied')
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 })
    }
    expect(queries.some((query) => query.text.includes('control.hospital_domain'))).toBe(false)
  })

  test('an unknown hospital is a 404 before authorisation', async () => {
    const { pool } = fakePool(() => [])
    let authorisations = 0
    const authorize: AdminDependencies['authorize'] = async () => {
      authorisations += 1
    }

    try {
      await listDomains(dependencies({ pool, authorize }), context, HOSPITAL_ID, {
        limit: 50,
        offset: 0,
      })
      throw new Error('expected the hospital to be missing')
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 })
    }
    expect(authorisations).toBe(0)
  })
})

function testApp(d: AdminDependencies) {
  return new Elysia().use(errors).use(hospitalsRouter(d))
}

function authorised(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `Bearer ${SESSION_TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('hospitals router', () => {
  test('requires a bearer session', async () => {
    const response = await testApp(dependencies()).handle(
      new Request(`http://localhost/v1/admin/organisations/${ORGANISATION_ID}/hospitals`),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })

  test('returns one page of hospitals with ISO instants', async () => {
    const { pool } = fakePool((text) => rowsFor(text, [hospitalRow()], []))
    const response = await testApp(dependencies({ pool })).handle(
      authorised('GET', `/v1/admin/organisations/${ORGANISATION_ID}/hospitals`),
    )
    const body = (await response.json()) as {
      items: { id: string; createdAt: string }[]
      nextOffset: number | null
    }

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.createdAt).toBe('2026-11-05T00:00:00.000Z')
    expect(body.nextOffset).toBeNull()
  })

  test('creates a hospital with 201 and the default timezone', async () => {
    const { pool } = fakePool((text) => rowsFor(text, [hospitalRow()], []))
    const audits = recordingAudit()
    const response = await testApp(dependencies({ pool, audit: audits.audit })).handle(
      authorised('POST', `/v1/admin/organisations/${ORGANISATION_ID}/hospitals`, {
        name: 'General Hospital',
        slug: 'general-hospital',
      }),
    )
    const body = (await response.json()) as { id: string; timezone: string }

    expect(response.status).toBe(201)
    expect(body.id).toBe(HOSPITAL_ID)
    expect(body.timezone).toBe('UTC')
    expect(audits.recorded).toHaveLength(1)
  })

  test('rejects a malformed path parameter with a validation error', async () => {
    const response = await testApp(dependencies()).handle(
      authorised('GET', '/v1/admin/hospitals/not-a-uuid/domains'),
    )
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  test('a forbidden actor cannot add a domain', async () => {
    const { pool, queries } = fakePool((text) => rowsFor(text, [hospitalRow()], [domainRow()]))
    const audits = recordingAudit()
    const authorize: AdminDependencies['authorize'] = async () => {
      throw new AppError('FORBIDDEN', 403, 'Not allowed.')
    }

    const response = await testApp(dependencies({ pool, authorize, audit: audits.audit })).handle(
      authorised('POST', `/v1/admin/hospitals/${HOSPITAL_ID}/domains`, {
        domain: 'hospital.example',
      }),
    )

    expect(response.status).toBe(403)
    expect(audits.recorded).toHaveLength(0)
    expect(queries.some((query) => query.text.includes('insert into control.hospital_domain'))).toBe(
      false,
    )
  })

  test('an unknown hospital returns 404 for its domains', async () => {
    const response = await testApp(dependencies()).handle(
      authorised('GET', `/v1/admin/hospitals/${HOSPITAL_ID}/domains`),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
