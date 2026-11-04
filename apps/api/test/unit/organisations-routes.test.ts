import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { Pool } from 'pg'
import type { AuditEvent, AuditSink } from '../../src/audit/audit-writer'
import type { AdminDependencies } from '../../src/controllers/admin/dependencies'
import type { OrganisationIdentity } from '../../src/controllers/admin/organisations/create-organisation'
import type { DatabaseQuery } from '../../src/db/pool'
import type { AppUser } from '../../src/identity/app-user-repository'
import type { WebSession } from '../../src/identity/session-repository'
import { errors } from '../../src/plugins/errors'
import { organisationsRouter } from '../../src/routes/organisations.router'
import { ZitadelUnavailableError } from '../../src/adapters/zitadel/client'
import type { Authorize } from '../../src/shared/authorize'
import { forbidden } from '../../src/shared/errors'

const NOW = new Date('2026-01-01T10:00:00.000Z')
const PROVISIONED_AT = new Date('2026-01-01T10:01:00.000Z')
const TOKEN = 'v'.repeat(43)
const ORGANISATION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = 'user-1'

const user: AppUser = {
  id: USER_ID,
  identityIssuer: 'https://identity.example.test',
  zitadelSubject: 'subject-1',
  email: 'admin@example.test',
  emailVerifiedAt: NOW,
  displayName: 'Dev Admin',
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

const sessions = {
  async authenticate(token: string) {
    return token === TOKEN ? session : null
  },
  async revoke() {
    return true
  },
}

const users = {
  async findById(id: string) {
    return id === user.id ? user : null
  },
}

const pendingRow: Record<string, unknown> = {
  id: ORGANISATION_ID,
  zitadel_org_id: null,
  name: 'General Hospital',
  slug: 'general',
  status: 'pending',
  provisioned_at: null,
  created_at: NOW,
}

const activeRow: Record<string, unknown> = {
  ...pendingRow,
  zitadel_org_id: 'zitadel-1',
  status: 'active',
  provisioned_at: PROVISIONED_AT,
}

type Responder = (text: string, values: readonly unknown[]) => readonly unknown[]

interface FakeDatabase {
  readonly db: DatabaseQuery
  readonly statements: string[]
  readonly parameters: (readonly unknown[])[]
}

function fakeDatabase(respond: Responder): FakeDatabase {
  const statements: string[] = []
  const parameters: (readonly unknown[])[] = []
  return {
    statements,
    parameters,
    db: {
      async query(text, values = []) {
        statements.push(text.trim())
        parameters.push(values)
        return { rows: respond(text, values) }
      },
    },
  }
}

/** Transaction control statements never reach the responder. */
function transactional(respond: Responder): Responder {
  return (text, values) => {
    const statement = text.trim()
    if (statement === 'begin' || statement === 'commit' || statement === 'rollback') return []
    return respond(statement, values)
  }
}

function provisioningDatabase(
  options: { readonly existing?: readonly unknown[]; readonly duplicate?: boolean } = {},
): FakeDatabase {
  return fakeDatabase(
    transactional((statement) => {
      if (statement.includes('pg_advisory_xact_lock')) return []
      if (statement.includes('where slug = $1')) return options.existing ?? []
      if (statement.includes('insert into control.organisation')) {
        if (options.duplicate === true) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' })
        }
        return [pendingRow]
      }
      if (statement.includes('instantiate_role_template')) return []
      if (statement.includes('update control.organisation')) return [activeRow]
      throw new Error(`unexpected SQL: ${statement}`)
    }),
  )
}

interface FakePool {
  readonly pool: Pool
  readonly connections: () => number
}

/**
 * A real Pool with its transport replaced: reads call pool.query and writes go
 * through connect, so both need swapping to keep PostgreSQL out of the test.
 */
function fakePool(db: DatabaseQuery): FakePool {
  let connects = 0
  const pool = new Pool()
  Object.defineProperty(pool, 'query', {
    value: (text: string, values?: unknown[]) => db.query(text, values),
  })
  Object.defineProperty(pool, 'connect', {
    value: async () => {
      connects += 1
      return {
        query: (text: string, values?: unknown[]) => db.query(text, values),
        release: () => {},
      }
    },
  })
  return { pool, connections: () => connects }
}

interface FakeAudit {
  readonly events: AuditEvent[]
  readonly sink: AuditSink
}

function fakeAudit(): FakeAudit {
  const events: AuditEvent[] = []
  return {
    events,
    sink: {
      async write(event) {
        events.push(event)
      },
    },
  }
}

interface Harness {
  readonly dependencies: AdminDependencies
  readonly pool: FakePool
  readonly audit: FakeAudit
}

function setup(database: FakeDatabase, overrides: Partial<AdminDependencies> = {}): Harness {
  const pool = fakePool(database.db)
  const audit = fakeAudit()
  return {
    pool,
    audit,
    dependencies: {
      pool: pool.pool,
      authorize: async () => {},
      permissions: async () => [],
      isPlatformAdmin: async () => true,
      audit: audit.sink,
      sessions,
      users,
      ...overrides,
    },
  }
}

const noProvider: OrganisationIdentity = {
  create: async () => {
    throw new Error('the provider must not be reached')
  },
}

function app(dependencies: AdminDependencies, identity: OrganisationIdentity = noProvider) {
  return new Elysia().use(errors).use(organisationsRouter(dependencies, identity))
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, init)
}

function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return request('/v1/admin/organisations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function get(path: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return request(path, { headers })
}

function identityThat(
  create: (name: string) => Promise<string>,
): OrganisationIdentity & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async create(name) {
      calls.push(name)
      return create(name)
    },
  }
}

function unusedIdentity(): OrganisationIdentity & { readonly calls: string[] } {
  return identityThat(async () => {
    throw new Error('the identity provider must not be called')
  })
}

describe('POST /v1/admin/organisations', () => {
  test('provisions the local row, the role catalogue and the provider in one commit', async () => {
    const database = provisioningDatabase()
    const { dependencies, audit } = setup(database)
    const identity = identityThat(async () => 'zitadel-1')

    const response = await app(dependencies, identity).handle(
      post({ name: 'General Hospital', slug: 'general' }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: ORGANISATION_ID,
      zitadelOrgId: 'zitadel-1',
      name: 'General Hospital',
      slug: 'general',
      status: 'active',
      provisionedAt: PROVISIONED_AT.toISOString(),
      createdAt: NOW.toISOString(),
    })
    expect(identity.calls).toEqual(['General Hospital'])
    expect(database.statements).toContain('commit')

    const templates = database.parameters
      .filter((_, index) => database.statements[index]?.includes('instantiate_role_template'))
      .map((values) => values[1])
    expect(templates).toEqual(['org_admin', 'hospital_admin', 'clinician', 'auditor'])

    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({
      actorUserId: USER_ID,
      actorType: 'user',
      organisationId: ORGANISATION_ID,
      eventType: 'admin.change',
      outcome: 'success',
      reasonCode: 'organisation.provisioned',
      targetType: 'organisation',
      targetId: ORGANISATION_ID,
      metadata: { resource_type: 'organisation', resource_id: ORGANISATION_ID },
    })
  })

  test('refuses a caller who is not a platform administrator before any write', async () => {
    const database = provisioningDatabase()
    const { dependencies, pool, audit } = setup(database, {
      isPlatformAdmin: async () => false,
    })

    const response = await app(dependencies, unusedIdentity()).handle(
      post({ name: 'General Hospital', slug: 'general' }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(pool.connections()).toBe(0)
    expect(database.statements).toEqual([])
    expect(audit.events).toEqual([])
  })

  test('requires a bearer session', async () => {
    const database = provisioningDatabase()
    const { dependencies, pool } = setup(database)

    const response = await app(dependencies, unusedIdentity()).handle(
      post({ name: 'General Hospital', slug: 'general' }, {}),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
    expect(pool.connections()).toBe(0)
  })

  test('keeps a pending row and a failure audit when the provider is unavailable', async () => {
    const database = provisioningDatabase()
    const { dependencies, audit } = setup(database)
    const identity: OrganisationIdentity = {
      async create() {
        throw new ZitadelUnavailableError()
      },
    }

    const response = await app(dependencies, identity).handle(
      post({ name: 'General Hospital', slug: 'general' }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } })
    expect(database.statements).toContain('commit')
    expect(database.statements).not.toContain('rollback')
    expect(database.statements.some((sql) => sql.includes('update control.organisation'))).toBe(false)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({
      actorUserId: USER_ID,
      eventType: 'admin.change',
      outcome: 'failure',
      reasonCode: 'organisation.provision_failed',
      targetId: ORGANISATION_ID,
      metadata: { resource_type: 'organisation', resource_id: ORGANISATION_ID },
    })
  })

  test('returns an existing active organisation without calling the provider again', async () => {
    const database = provisioningDatabase({ existing: [activeRow] })
    const { dependencies, audit } = setup(database)
    const identity = unusedIdentity()

    const response = await app(dependencies, identity).handle(
      post({ name: 'General Hospital', slug: 'general' }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ status: 'active', zitadelOrgId: 'zitadel-1' })
    expect(identity.calls).toEqual([])
    expect(database.statements.some((sql) => sql.includes('update control.organisation'))).toBe(false)
    expect(audit.events).toEqual([])
  })

  test('maps a duplicate slug to a conflict and rolls the transaction back', async () => {
    const database = provisioningDatabase({ duplicate: true })
    const { dependencies } = setup(database)

    const response = await app(dependencies, unusedIdentity()).handle(
      post({ name: 'General Hospital', slug: 'general' }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'CONFLICT', message: 'An organisation with this slug already exists.' },
    })
    expect(database.statements).toContain('rollback')
  })

  test('validates the body before touching the database', async () => {
    const database = provisioningDatabase()
    const { dependencies, pool } = setup(database)

    const response = await app(dependencies, unusedIdentity()).handle(
      post({ name: '', slug: 'Not A Slug' }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
    expect(pool.connections()).toBe(0)
  })
})

describe('GET /v1/admin/organisations', () => {
  test('lists every organisation for a platform administrator', async () => {
    const database = fakeDatabase((statement) => {
      if (statement.includes('from control.organisation') && statement.includes('order by name, id')) {
        return [pendingRow, activeRow, pendingRow]
      }
      throw new Error(`unexpected SQL: ${statement}`)
    })
    const { dependencies } = setup(database)

    const response = await app(dependencies).handle(get('/v1/admin/organisations?limit=2'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.nextOffset).toBe(2)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items as unknown[]).toHaveLength(2)
    expect(database.statements[0]).toContain('limit $1 offset $2')
    expect(database.parameters[0]).toEqual([3, 0])
  })

  test('lists only the organisations the caller belongs to', async () => {
    const database = fakeDatabase((statement) => {
      if (statement.includes('control.membership')) return [activeRow]
      throw new Error(`unexpected SQL: ${statement}`)
    })
    const { dependencies } = setup(database, { isPlatformAdmin: async () => false })

    const response = await app(dependencies).handle(get('/v1/admin/organisations'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ nextOffset: null })
    expect(body.items as unknown[]).toHaveLength(1)
    expect(database.parameters[0]?.[0]).toBe(USER_ID)
    expect(database.statements[0]).toContain("status = 'active'")
  })
})

describe('GET /v1/admin/organisations/:organisationId', () => {
  test('authorises organisation.manage and returns ISO instants', async () => {
    const authorizations: { permission: string; organisationId: string }[] = []
    const authorize: Authorize = async (_actorId, permission, target) => {
      authorizations.push({ permission, organisationId: target.organisationId })
    }
    const database = fakeDatabase((statement) => {
      if (statement.includes('from control.organisation where id = $1')) return [activeRow]
      throw new Error(`unexpected SQL: ${statement}`)
    })
    const { dependencies } = setup(database, { authorize })

    const response = await app(dependencies).handle(
      get(`/v1/admin/organisations/${ORGANISATION_ID}`),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: ORGANISATION_ID,
      provisionedAt: PROVISIONED_AT.toISOString(),
      createdAt: NOW.toISOString(),
    })
    expect(authorizations).toEqual([
      { permission: 'organisation.manage', organisationId: ORGANISATION_ID },
    ])
  })

  test('returns not found when the organisation does not exist', async () => {
    const database = fakeDatabase((statement) => {
      if (statement.includes('from control.organisation where id = $1')) return []
      throw new Error(`unexpected SQL: ${statement}`)
    })
    const { dependencies } = setup(database)

    const response = await app(dependencies).handle(
      get(`/v1/admin/organisations/${ORGANISATION_ID}`),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Organisation not found.' },
    })
  })

  test('denies before reading the organisation', async () => {
    const database = fakeDatabase(() => {
      throw new Error('the repository must not be called for a denied actor')
    })
    const { dependencies, audit } = setup(database, {
      authorize: async () => {
        throw forbidden()
      },
    })

    const response = await app(dependencies).handle(
      get(`/v1/admin/organisations/${ORGANISATION_ID}`),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(database.statements).toEqual([])
    expect(audit.events).toEqual([])
  })

  test('rejects a malformed organisation id', async () => {
    const database = fakeDatabase(() => [])
    const { dependencies } = setup(database)

    const response = await app(dependencies).handle(get('/v1/admin/organisations/not-a-uuid'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
  })
})
