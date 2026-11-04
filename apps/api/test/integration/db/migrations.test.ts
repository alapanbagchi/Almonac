/**
 * One suite owns the test database lifecycle: it resets the schema before the
 * tests and leaves the database empty afterwards. Keep the suite in one file
 * unless the reset moves into a serialized shared harness; parallel files would
 * race on the same database.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { migrateDatabase } from '../../../src/db/migrate'
import { CONTROL_RUNTIME_ROLE } from '../../../src/db/pool'
import {
  AppUserEmailConflictError,
  AppUserRepository,
} from '../../../src/identity/app-user-repository'
import { AuditWriter } from '../../../src/audit/audit-writer'
import { SessionRepository } from '../../../src/identity/session-repository'
import { AccessRepository } from '../../../src/identity/access-repository'
import { PostgresLoginStore } from '../../../src/auth/postgres-login-store'
import { LoginRejectedError } from '../../../src/auth/login-service'
import { AuthorizationRepository } from '../../../src/access/authorization-repository'
import { InvitationRepository } from '../../../src/admin/invitation-repository'
import { InvitationService } from '../../../src/admin/invitation-service'
import { MembershipAdminRepository } from '../../../src/admin/membership-admin-repository'
import { OrganisationRepository } from '../../../src/admin/organisation-repository'
import { HospitalRepository } from '../../../src/admin/hospital-repository'
import { ZitadelManagementClient } from '../../../src/admin/zitadel-management-client'
import { AppError } from '../../../src/shared/errors'
import { Elysia } from 'elysia'
import { createAdmin } from '../../../src/admin/routes'
import { errors } from '../../../src/plugins/errors'
import { OrganisationAdminService } from '../../../src/admin/organisation-admin-service'
import { OrganisationProvisioningService } from '../../../src/admin/organisation-provisioning-service'
import { HospitalAdminService } from '../../../src/admin/hospital-admin-service'
import { MembershipAdminService } from '../../../src/admin/membership-admin-service'
import { AuditAdminService } from '../../../src/admin/audit-admin-service'
import { AuditReadRepository } from '../../../src/admin/audit-read-repository'
import { SessionService } from '../../../src/identity/session-service'
import type { LoginAttempt } from '../../../src/auth/login-attempt-repository'
import type { VerifiedIdentity } from '../../../src/auth/id-token-verifier'

const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required. Start infrastructure/local and copy apps/api/.env.example to apps/api/.env.',
  )
}

const ownerPool = new Pool({ connectionString: databaseUrl })
const appPool = new Pool({
  connectionString: databaseUrl,
  options: `-c role=${CONTROL_RUNTIME_ROLE}`,
})

async function withTransaction(
  db: Pool,
  run: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await run(client)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

async function rejects(
  client: PoolClient,
  text: string,
  values: unknown[],
  code: string,
): Promise<void> {
  await client.query('savepoint expected_error')
  try {
    await expect(client.query(text, values)).rejects.toMatchObject({ code })
  } finally {
    await client.query('rollback to savepoint expected_error')
  }
}

async function createOrganisation(
  client: Pool | PoolClient,
  slug: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into control.organisation
       (zitadel_org_id, name, slug, status, provisioned_at)
     values ($1, $2, $3, 'active', now())
     returning id`,
    [`zitadel-${slug}`, slug, slug],
  )

  return result.rows[0]!.id
}

async function createHospital(
  client: Pool | PoolClient,
  organisationId: string,
  slug: string,
  active = false,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into control.hospital (organisation_id, name, slug)
     values ($1, $2, $3)
     returning id`,
    [organisationId, slug, slug],
  )
  const id = result.rows[0]!.id

  if (!active) return id

  const domain = await createDomain(client, id, `${slug}.example.test`, true)
  await client.query(
    `update control.hospital
     set primary_domain_id = $2, status = 'active'
     where id = $1`,
    [id, domain],
  )

  return id
}

async function createDomain(
  client: Pool | PoolClient,
  hospitalId: string,
  domain: string,
  verified = false,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into control.hospital_domain (hospital_id, domain, verified_at)
     values ($1, $2, case when $3 then now() else null end)
     returning id`,
    [hospitalId, domain, verified],
  )

  return result.rows[0]!.id
}

async function createUser(
  client: Pool | PoolClient,
  subject: string,
  email: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into identity.app_user (identity_issuer, zitadel_sub, email, display_name)
     values ('http://localhost:8080', $1, $2, 'Test User')
     returning id`,
    [subject, email],
  )

  return result.rows[0]!.id
}

async function createRole(
  client: Pool | PoolClient,
  organisationId: string,
  key: string,
  scope: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into control.role (organisation_id, key, name, scope)
     values ($1, $2, $3, $4)
     returning id`,
    [organisationId, key, key, scope],
  )

  return result.rows[0]!.id
}

async function createTemplateVersion(
  client: PoolClient,
  key: string,
  scope: string,
  name: string,
): Promise<string> {
  const template = await client.query<{ id: string }>(
    `insert into control.role_template (key, scope)
     values ($1, $2)
     returning id`,
    [key, scope],
  )
  const version = await client.query<{ id: string }>(
    `insert into control.role_template_version (template_id, version, name)
     values ($1, 1, $2)
     returning id`,
    [template.rows[0]!.id, name],
  )

  return version.rows[0]!.id
}

async function findSystemRole(
  client: Pool | PoolClient,
  key: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from control.role
     where organisation_id is null and key = $1`,
    [key],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error(`missing system role ${key}`)

  return id
}

async function createMembership(
  client: Pool | PoolClient,
  userId: string,
  organisationId: string,
  hospitalId: string | null,
  startMinutes = 0,
  endMinutes: number | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into control.membership
       (user_id, organisation_id, hospital_id, accepted_at, validity, created_at, updated_at)
     values (
       $1,
       $2,
       $3,
       now() + $4::interval,
       tstzrange(
         now() + $4::interval,
         case when $5::interval is null then null else now() + $5::interval end,
         '[)'
       ),
       now() + $4::interval,
       now() + $4::interval
     )
     returning id`,
    [
      userId,
      organisationId,
      hospitalId,
      `${startMinutes} minutes`,
      endMinutes === null ? null : `${endMinutes} minutes`,
    ],
  )

  return result.rows[0]!.id
}

async function createInvitation(
  client: Pool | PoolClient,
  email: string,
  organisationId: string,
  hospitalId: string | null,
  invitedBy: string,
  createdMinutes = 0,
  expiresMinutes = 60,
  kind: 'new_user' | 'existing_user' = 'new_user',
  zitadelSub: string | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into identity.invitation
       (email, organisation_id, hospital_id, token_hash, kind, zitadel_sub, invited_by, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval, now() + $9::interval)
     returning id`,
    [
      email,
      organisationId,
      hospitalId,
      randomBytes(32),
      kind,
      zitadelSub,
      invitedBy,
      `${createdMinutes} minutes`,
      `${expiresMinutes} minutes`,
    ],
  )

  return result.rows[0]!.id
}

async function createAudit(
  client: PoolClient,
  metadata: unknown = {},
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into audit.event (actor_type, event_type, outcome, metadata)
     values ('system', 'auth.login', 'success', $1::jsonb)
     returning id`,
    [JSON.stringify(metadata)],
  )

  return result.rows[0]!.id
}

beforeAll(async () => {
  await migrateDatabase(databaseUrl, 'down', 1_000)
  await migrateDatabase(databaseUrl, 'up')
})

afterAll(async () => {
  await migrateDatabase(databaseUrl, 'down', 1_000)
  await appPool.end()
  await ownerPool.end()
})

describe('control database schema', () => {
  test('creates the identity, control and audit objects', async () => {
    const result = await ownerPool.query<{ table_name: string }>(
      `select n.nspname || '.' || c.relname as table_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('identity', 'control', 'audit')
         and c.relkind in ('r', 'p')
       order by 1`,
    )
    const tables = result.rows.map((row) => row.table_name)

    for (const table of [
      'identity.app_user',
      'identity.login_attempt',
      'identity.web_session',
      'identity.invitation',
      'control.organisation',
      'control.hospital',
      'control.hospital_domain',
      'control.schema_metadata',
      'control.permission',
      'control.role',
      'control.role_template',
      'control.role_template_version',
      'control.role_template_permission',
      'control.role_permission',
      'control.platform_assignment',
      'control.membership',
      'control.membership_role',
      'control.invitation_role',
      'control.break_glass_grant',
      'control.break_glass_review',
      'audit.event',
      'audit.event_type',
    ]) {
      expect(tables).toContain(table)
    }

    const partitions = await ownerPool.query<{ count: number }>(
      `select count(*)::int as count
       from pg_inherits
       where inhparent = 'audit.event'::regclass`,
    )
    expect(partitions.rows[0]!.count).toBeGreaterThanOrEqual(3)
  })

  test('records the schema version', async () => {
    const result = await ownerPool.query<{ version: number }>(
      'select version from control.schema_metadata where id = 1',
    )

    expect(result.rows[0]?.version).toBe(5)
  })
})

describe('runtime privileges', () => {
  test('connects as the least-privilege role', async () => {
    const result = await appPool.query<{
      runtime_role: string
      can_create_control: boolean
      can_insert_audit: boolean
      can_update_audit: boolean
      can_delete_audit: boolean
      can_truncate_audit: boolean
      can_delete_membership_role: boolean
      can_delete_invitation_role: boolean
      can_insert_break_glass_review: boolean
    }>(
      `select
         current_user as runtime_role,
         has_schema_privilege('control', 'CREATE') as can_create_control,
         has_table_privilege('audit.event', 'INSERT') as can_insert_audit,
         has_table_privilege('audit.event', 'UPDATE') as can_update_audit,
         has_table_privilege('audit.event', 'DELETE') as can_delete_audit,
         has_table_privilege('audit.event', 'TRUNCATE') as can_truncate_audit,
         has_table_privilege('control.membership_role', 'DELETE') as can_delete_membership_role,
         has_table_privilege('control.invitation_role', 'DELETE') as can_delete_invitation_role,
         has_table_privilege('control.break_glass_review', 'INSERT') as can_insert_break_glass_review`,
    )
    const row = result.rows[0]!

    expect(row.runtime_role).toBe(CONTROL_RUNTIME_ROLE)
    expect(row.can_create_control).toBe(false)
    expect(row.can_insert_audit).toBe(true)
    expect(row.can_update_audit).toBe(false)
    expect(row.can_delete_audit).toBe(false)
    expect(row.can_truncate_audit).toBe(false)
    expect(row.can_delete_membership_role).toBe(false)
    expect(row.can_delete_invitation_role).toBe(false)
    expect(row.can_insert_break_glass_review).toBe(true)
  })

  test('keeps the runtime role when reset and drops it with set role none', async () => {
    const loginRole = `almonac_login_${randomBytes(4).toString('hex')}`
    const password = randomBytes(24).toString('base64url')

    await ownerPool.query(
      `create role ${loginRole} login noinherit password '${password}'`,
    )
    await ownerPool.query(`grant ${CONTROL_RUNTIME_ROLE} to ${loginRole}`)

    const loginUrl = new URL(databaseUrl)
    loginUrl.username = loginRole
    loginUrl.password = password
    const loginPool = new Pool({
      connectionString: loginUrl.toString(),
      options: `-c role=${CONTROL_RUNTIME_ROLE}`,
    })

    try {
      const client = await loginPool.connect()
      try {
        const asRuntime = await client.query<{ current_user: string }>(
          'select current_user',
        )
        expect(asRuntime.rows[0]?.current_user).toBe(CONTROL_RUNTIME_ROLE)

        await client.query('reset role')
        const afterReset = await client.query<{
          current_user: string
          can_insert_audit: boolean
        }>(
          `select
             current_user,
             has_table_privilege('audit.event', 'INSERT') as can_insert_audit`,
        )

        expect(afterReset.rows[0]?.current_user).toBe(CONTROL_RUNTIME_ROLE)
        expect(afterReset.rows[0]?.can_insert_audit).toBe(true)

        await client.query('set role none')
        const afterNone = await client.query<{ current_user: string }>(
          'select current_user',
        )

        expect(afterNone.rows[0]?.current_user).toBe(loginRole)
        await expect(
          client.query('select count(*) from audit.event'),
        ).rejects.toMatchObject({ code: '42501' })
      } finally {
        client.release()
      }
    } finally {
      await loginPool.end()
      await ownerPool.query(
        `revoke ${CONTROL_RUNTIME_ROLE} from ${loginRole}`,
      )
      await ownerPool.query(`drop role ${loginRole}`)
    }
  })

  test('lets the runtime append and read audit events', async () => {
    await withTransaction(appPool, async (client) => {
      const id = await createAudit(client)
      const result = await client.query<{ id: string }>(
        'select id from audit.event where id = $1',
        [id],
      )

      expect(result.rows).toHaveLength(1)

      await rejects(
        client,
        `insert into audit.event (occurred_at, actor_type, event_type, outcome)
         values ('2000-01-01', 'system', 'auth.login', 'success')`,
        [],
        '23514',
      )
    })
  })

  test('denies audit mutation and schema creation to the runtime', async () => {
    await withTransaction(appPool, async (client) => {
      const id = await createAudit(client)
      await expect(
        client.query('update audit.event set outcome = $1 where id = $2', [
          'failure',
          id,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    })

    await withTransaction(appPool, async (client) => {
      const id = await createAudit(client)
      await expect(
        client.query('delete from audit.event where id = $1', [id]),
      ).rejects.toMatchObject({ code: '42501' })
    })

    await withTransaction(appPool, async (client) => {
      await createAudit(client)
      await expect(client.query('truncate audit.event')).rejects.toMatchObject({
        code: '42501',
      })
    })

    await withTransaction(appPool, async (client) => {
      await expect(
        client.query('create table control.denied (id integer)'),
      ).rejects.toMatchObject({ code: '42501' })
    })

    await withTransaction(appPool, async (client) => {
      await expect(
        client.query('truncate identity.app_user'),
      ).rejects.toMatchObject({ code: '42501' })
    })

    await withTransaction(appPool, async (client) => {
      await expect(
        client.query(
          'update control.schema_metadata set version = 5 where id = 1',
        ),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  test('denies role catalogue changes to the runtime', async () => {
    await withTransaction(appPool, async (client) => {
      await rejects(
        client,
        `insert into control.permission (key, scope, description)
         values ($1, $2, $3)`,
        ['test.manage', 'platform', 'Test permission.'],
        '42501',
      )

      await rejects(
        client,
        `update control.role set name = $1 where organisation_id is null and key = $2`,
        ['Changed name', 'platform_admin'],
        '42501',
      )

      await rejects(
        client,
        `insert into control.role_permission (role_id, permission_key)
         select role.id, permission.key
         from control.role
         join control.permission on permission.key = 'clinical.read'
         where role.organisation_id is null and role.key = 'platform_admin'`,
        [],
        '42501',
      )
    })
  })

  test('denies platform assignments to the runtime', async () => {
    const suffix = randomBytes(4).toString('hex')

    await withTransaction(appPool, async (client) => {
      const userId = await createUser(
        client,
        `platform-${suffix}`,
        `platform-${suffix}@example.test`,
      )
      const roleId = await findSystemRole(client, 'platform_admin')

      await rejects(
        client,
        `insert into control.platform_assignment (user_id, role_id)
         values ($1, $2)`,
        [userId, roleId],
        '42501',
      )
    })
  })

  test('denies hard deletion of identity and tenancy records', async () => {
    const suffix = randomBytes(4).toString('hex')

    await withTransaction(appPool, async (client) => {
      const organisation = await createOrganisation(
        client,
        `delete-org-${suffix}`,
      )
      const hospital = await createHospital(
        client,
        organisation,
        `delete-hospital-${suffix}`,
      )
      const user = await createUser(
        client,
        `delete-${suffix}`,
        `delete-${suffix}@example.test`,
      )
      const membership = await createMembership(
        client,
        user,
        organisation,
        hospital,
      )

      for (const [text, values] of [
        ['delete from identity.app_user where id = $1', [user]],
        ['delete from control.organisation where id = $1', [organisation]],
        ['delete from control.hospital where id = $1', [hospital]],
        ['delete from control.membership where id = $1', [membership]],
      ] as const) {
        await rejects(client, text, [...values], '42501')
      }
    })
  })

  test('does not grant execution on new functions', async () => {
    await withTransaction(ownerPool, async (client) => {
      await client.query(
        `create function identity.test_future_function()
         returns integer language sql as $$ select 1 $$`,
      )

      const result = await client.query<{ can_execute: boolean }>(
        `select has_function_privilege(
           'almonac_app',
           'identity.test_future_function()',
           'EXECUTE'
         ) as can_execute`,
      )

      expect(result.rows[0]?.can_execute).toBe(false)
    })
  })

  test('grants the runtime access to new audit partitions', async () => {
    const target = new Date()
    target.setUTCDate(1)
    target.setUTCMonth(target.getUTCMonth() + 2)
    const month = target.toISOString().slice(0, 7)
    const partition = `audit.event_${month.replace('-', '_')}`

    await ownerPool.query('select audit.ensure_month_partition($1::date)', [
      `${month}-01`,
    ])

    const result = await appPool.query<{
      can_insert: boolean
      can_delete: boolean
    }>(
      `select has_table_privilege($1, 'INSERT') as can_insert,
              has_table_privilege($1, 'DELETE') as can_delete`,
      [partition],
    )

    expect(result.rows[0]).toEqual({ can_insert: true, can_delete: false })
  })

  test('keeps append-only triggers for the owner', async () => {
    await withTransaction(ownerPool, async (client) => {
      const id = await createAudit(client)
      await expect(
        client.query('update audit.event set outcome = $1 where id = $2', [
          'failure',
          id,
        ]),
      ).rejects.toMatchObject({ code: '55000' })
    })

    await withTransaction(ownerPool, async (client) => {
      const id = await createAudit(client)
      await expect(
        client.query('delete from audit.event where id = $1', [id]),
      ).rejects.toMatchObject({ code: '55000' })
    })

    await withTransaction(ownerPool, async (client) => {
      await createAudit(client)
      await expect(client.query('truncate audit.event')).rejects.toMatchObject({
        code: '55000',
      })
    })
  })
})

describe('access model', () => {
  test('enforces role scope, immutability and permission ranking', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'role-model')
      const organisationRole = await createRole(
        client,
        organisation,
        'org_role',
        'organisation',
      )

      await rejects(
        client,
        'update control.role set scope = $1 where id = $2',
        ['hospital', organisationRole],
        '23514',
      )
      await rejects(
        client,
        'update control.role set key = $1 where id = $2',
        ['renamed_role', organisationRole],
        '23514',
      )

      const renamed = await client.query(
        'update control.role set name = $1 where id = $2',
        ['Renamed role', organisationRole],
      )
      expect(renamed.rowCount).toBe(1)

      await rejects(
        client,
        'insert into control.role_permission (role_id, permission_key) values ($1, $2)',
        [organisationRole, 'platform.manage'],
        '23514',
      )
      await client.query(
        'insert into control.role_permission (role_id, permission_key) values ($1, $2)',
        [organisationRole, 'hospital.manage'],
      )

      const hospitalRole = await createRole(
        client,
        organisation,
        'hospital_role',
        'hospital',
      )
      await rejects(
        client,
        'insert into control.role_permission (role_id, permission_key) values ($1, $2)',
        [hospitalRole, 'organisation.manage'],
        '23514',
      )

      const user = await createUser(
        client,
        'subject-role-user',
        'role-user@example.test',
      )
      const platformRole = await findSystemRole(client, 'platform_admin')

      await client.query(
        'insert into control.platform_assignment (user_id, role_id) values ($1, $2)',
        [user, platformRole],
      )
      await rejects(
        client,
        'insert into control.platform_assignment (user_id, role_id) values ($1, $2)',
        [user, organisationRole],
        '23514',
      )

      const templateVersion = await createTemplateVersion(
        client,
        'org_template',
        'organisation',
        'Organisation template',
      )
      await rejects(
        client,
        'insert into control.role_template_permission (template_version_id, permission_key) values ($1, $2)',
        [templateVersion, 'platform.manage'],
        '23514',
      )

      const hospitalTemplateVersion = await createTemplateVersion(
        client,
        'hospital_template',
        'hospital',
        'Hospital template',
      )
      await rejects(
        client,
        'insert into control.role_template_permission (template_version_id, permission_key) values ($1, $2)',
        [hospitalTemplateVersion, 'organisation.manage'],
        '23514',
      )
      await rejects(
        client,
        'update control.role_template_version set name = $1 where id = $2',
        ['Renamed template', templateVersion],
        '23514',
      )
      await rejects(
        client,
        'update control.role_template_version set version = 2 where id = $1',
        [templateVersion],
        '23514',
      )
    })
  })


  test('instantiates a role from the newest template version as the runtime', async () => {
    const suffix = randomBytes(4).toString('hex')
    const organisation = await createOrganisation(
      ownerPool,
      `instantiate-${suffix}`,
    )

    const first = await appPool.query<{ role_id: string }>(
      'select control.instantiate_role_template($1, $2) as role_id',
      [organisation, 'org_admin'],
    )
    const second = await appPool.query<{ role_id: string }>(
      'select control.instantiate_role_template($1, $2) as role_id',
      [organisation, 'org_admin'],
    )
    const roleId = first.rows[0]!.role_id
    expect(second.rows[0]!.role_id).toBe(roleId)

    const role = await appPool.query<{
      key: string
      scope: string
      is_system: boolean
      source_template_version_id: string
    }>(
      `select key, scope, is_system, source_template_version_id
         from control.role where id = $1`,
      [roleId],
    )
    expect(role.rows[0]).toMatchObject({
      key: 'org_admin',
      scope: 'organisation',
      is_system: false,
    })

    const permissions = await appPool.query<{ permission_key: string }>(
      'select permission_key from control.role_permission where role_id = $1 order by 1',
      [roleId],
    )
    expect(permissions.rows.map((row) => row.permission_key)).toEqual([
      'audit.read',
      'hospital.manage',
      'membership.manage',
      'organisation.manage',
    ])

    await expect(
      appPool.query('select control.instantiate_role_template($1, $2)', [
        organisation,
        'missing_template',
      ]),
    ).rejects.toMatchObject({ code: '23503' })

    await ownerPool.query('delete from control.role where id = $1', [roleId])
  })

  test('scopes external identities by issuer', async () => {
    await withTransaction(ownerPool, async (client) => {
      await createUser(
        client,
        'subject-shared',
        'issuer-first@example.test',
      )

      await client.query(
        `insert into identity.app_user
           (identity_issuer, zitadel_sub, email, display_name)
         values ('https://other.example', 'subject-shared', 'issuer-second@example.test', 'Other Issuer')`,
      )
      await rejects(
        client,
        `insert into identity.app_user
           (identity_issuer, zitadel_sub, email, display_name)
         values ('http://localhost:8080', 'subject-shared', 'issuer-third@example.test', 'Duplicate')`,
        [],
        '23505',
      )
      await rejects(
        client,
        `update identity.app_user
            set identity_issuer = 'https://other.example'
          where email = 'issuer-first@example.test'`,
        [],
        '23514',
      )
    })
  })

  test('requires roles to match membership scope', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'membership-model')
      const hospital = await createHospital(
        client,
        organisation,
        'membership-hospital',
        true,
      )
      const user = await createUser(
        client,
        'subject-membership-user',
        'membership-user@example.test',
      )
      const membership = await createMembership(
        client,
        user,
        organisation,
        hospital,
      )
      const platformRole = await findSystemRole(client, 'platform_admin')

      await rejects(
        client,
        'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
        [membership, platformRole],
        '23514',
      )

      const organisationRole = await createRole(
        client,
        organisation,
        'org_membership_role',
        'organisation',
      )
      await rejects(
        client,
        'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
        [membership, organisationRole],
        '23514',
      )

      const hospitalRole = await createRole(
        client,
        organisation,
        'hospital_membership_role',
        'hospital',
      )
      const assignment = await client.query<{ id: string }>(
        `insert into control.membership_role (membership_id, role_id, assigned_by)
         values ($1, $2, $3)
         returning id`,
        [membership, hospitalRole, user],
      )
      await rejects(
        client,
        'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
        [membership, hospitalRole],
        '23P01',
      )
      await client.query(
        `update control.membership_role
            set revoked_at = now(), revoked_by = $2, revoke_reason = 'Rotation'
          where id = $1`,
        [assignment.rows[0]!.id, user],
      )
      await client.query(
        `insert into control.membership_role (membership_id, role_id, assigned_by)
         values ($1, $2, $3)`,
        [membership, hospitalRole, user],
      )

      const revokedUser = await createUser(
        client,
        'subject-revoked-membership',
        'revoked-membership@example.test',
      )
      const revokedMembership = await createMembership(
        client,
        revokedUser,
        organisation,
        hospital,
      )
      await client.query(
        `update control.membership
            set status = 'revoked',
                revoked_at = now(),
                revoked_by = $2,
                revoke_reason = 'test revocation'
          where id = $1`,
        [revokedMembership, user],
      )
      await rejects(
        client,
        'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
        [revokedMembership, hospitalRole],
        '23514',
      )
      await rejects(
        client,
        `update control.membership
            set status = 'active', revoked_at = null,
                revoked_by = null, revoke_reason = null
          where id = $1`,
        [revokedMembership],
        '23514',
      )
      await rejects(
        client,
        'update control.membership set revoke_reason = $1 where id = $2',
        ['Changed reason', revokedMembership],
        '23514',
      )

      const organisationMembership = await createMembership(
        client,
        user,
        organisation,
        null,
      )
      await rejects(
        client,
        'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
        [organisationMembership, hospitalRole],
        '23514',
      )

      const secondOrganisationRole = await createRole(
        client,
        organisation,
        'org_membership_role_two',
        'organisation',
      )
      await client.query(
        'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
        [organisationMembership, secondOrganisationRole],
      )
    })
  })

  test('rejects overlapping active memberships', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'membership-overlap')
      const hospital = await createHospital(
        client,
        organisation,
        'overlap-hospital',
        true,
      )
      const user = await createUser(
        client,
        'subject-overlap-user',
        'overlap-user@example.test',
      )

      await createMembership(client, user, organisation, hospital, 0, 60)
      await rejects(
        client,
        `insert into control.membership
           (user_id, organisation_id, hospital_id, accepted_at, validity)
         values (
           $1, $2, $3,
           now() + interval '30 minutes',
           tstzrange(now() + interval '30 minutes', now() + interval '120 minutes', '[)')
         )`,
        [user, organisation, hospital],
        '23P01',
      )
      await createMembership(client, user, organisation, hospital, 120, 180)

      const organisationUser = await createUser(
        client,
        'subject-overlap-org-user',
        'overlap-org-user@example.test',
      )
      await createMembership(client, organisationUser, organisation, null, 0, 60)
      await rejects(
        client,
        `insert into control.membership
           (user_id, organisation_id, accepted_at, validity)
         values (
           $1, $2,
           now() + interval '30 minutes',
           tstzrange(now() + interval '30 minutes', now() + interval '120 minutes', '[)')
         )`,
        [organisationUser, organisation],
        '23P01',
      )
    })
  })

  test('requires pending, non-overlapping invitations', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'invitations')
      const hospital = await createHospital(
        client,
        organisation,
        'invitation-hospital',
        true,
      )
      const inviter = await createUser(
        client,
        'subject-inviter',
        'inviter@example.test',
      )
      const email = 'invitee@example.test'

      await createInvitation(client, email, organisation, hospital, inviter, 0, 60)
      await rejects(
        client,
        `insert into identity.invitation
           (email, organisation_id, hospital_id, token_hash, kind, invited_by, created_at, expires_at)
         values ($1, $2, $3, $4, 'new_user', $5, now(), now() + interval '120 minutes')`,
        [email, organisation, hospital, randomBytes(32), inviter],
        '23P01',
      )
      await createInvitation(client, email, organisation, hospital, inviter, 60, 120)

      const organisationEmail = 'org-invitee@example.test'
      await createInvitation(
        client,
        organisationEmail,
        organisation,
        null,
        inviter,
        0,
        60,
      )
      await rejects(
        client,
        `insert into identity.invitation
           (email, organisation_id, token_hash, kind, invited_by, created_at, expires_at)
         values ($1, $2, $3, 'new_user', $4, now(), now() + interval '120 minutes')`,
        [organisationEmail, organisation, randomBytes(32), inviter],
        '23P01',
      )

      await rejects(
        client,
        `insert into identity.invitation
           (email, organisation_id, hospital_id, token_hash, kind, invited_by, expires_at)
         values ($1, $2, $3, $4, 'existing_user', $5, now() + interval '60 minutes')`,
        ['existing@example.test', organisation, hospital, randomBytes(32), inviter],
        '23514',
      )

      const acceptedBy = await createUser(
        client,
        'subject-invitation-accepter',
        'invitation-accepter@example.test',
      )
      await rejects(
        client,
        `insert into identity.invitation
           (email, organisation_id, hospital_id, token_hash, kind, invited_by,
            status, accepted_at, accepted_by_user_id, expires_at)
         values ($1, $2, $3, $4, 'new_user', $5, 'accepted', now(), $6, now() + interval '1 hour')`,
        [
          'preaccepted@example.test',
          organisation,
          hospital,
          randomBytes(32),
          inviter,
          acceptedBy,
        ],
        '23514',
      )

      const expired = await createInvitation(
        client,
        'expired@example.test',
        organisation,
        hospital,
        inviter,
        -120,
        -60,
      )
      await rejects(
        client,
        `update identity.invitation
         set status = 'accepted', accepted_at = now() - interval '90 minutes',
             accepted_by_user_id = $2
         where id = $1`,
        [expired, acceptedBy],
        '23514',
      )

      const accepted = await createInvitation(
        client,
        'accepted@example.test',
        organisation,
        hospital,
        inviter,
        0,
        60,
      )
      await client.query(
        `update identity.invitation
         set status = 'accepted', accepted_at = now(), accepted_by_user_id = $2
         where id = $1`,
        [accepted, acceptedBy],
      )
      const role = await createRole(
        client,
        organisation,
        'invitation_hospital_role',
        'hospital',
      )
      await rejects(
        client,
        'insert into control.invitation_role (invitation_id, role_id) values ($1, $2)',
        [accepted, role],
        '23514',
      )
      await rejects(
        client,
        `update identity.invitation set status = 'pending' where id = $1`,
        [accepted],
        '23514',
      )
      await rejects(
        client,
        'update identity.invitation set accepted_by_user_id = $1 where id = $2',
        [inviter, accepted],
        '23514',
      )
    })
  })

  test('validates hospital domains and the primary domain', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'hospital-domains')
      const hospital = await createHospital(
        client,
        organisation,
        'domain-hospital',
      )

      await rejects(
        client,
        'update control.hospital set status = $1 where id = $2',
        ['active', hospital],
        '23514',
      )
      await rejects(
        client,
        'insert into control.hospital_domain (hospital_id, domain) values ($1, $2)',
        [hospital, 'bad-.example.test'],
        '23514',
      )
      await rejects(
        client,
        'insert into control.hospital_domain (hospital_id, domain) values ($1, $2)',
        [hospital, 'localhost'],
        '23514',
      )

      const domain = await createDomain(
        client,
        hospital,
        'primary.example.test',
        true,
      )
      await client.query(
        `update control.hospital
         set primary_domain_id = $2, status = 'active'
         where id = $1`,
        [hospital, domain],
      )

      await rejects(
        client,
        'update control.hospital_domain set retired_at = now() where id = $1',
        [domain],
        '23514',
      )
      await rejects(
        client,
        'update control.hospital_domain set verified_at = null where id = $1',
        [domain],
        '23514',
      )
      await rejects(
        client,
        'update control.hospital_domain set domain = $1 where id = $2',
        ['renamed.example.test', domain],
        '23514',
      )

      const otherHospital = await createHospital(
        client,
        organisation,
        'other-domain-hospital',
      )
      await rejects(
        client,
        'insert into control.hospital_domain (hospital_id, domain) values ($1, $2)',
        [otherHospital, 'primary.example.test'],
        '23505',
      )

      const otherDomain = await createDomain(
        client,
        otherHospital,
        'other.example.test',
        true,
      )
      await rejects(
        client,
        'update control.hospital set primary_domain_id = $1 where id = $2',
        [otherDomain, hospital],
        '23514',
      )
    })
  })

  test('enforces break-glass approval, activation and review rules', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'break-glass')
      const hospital = await createHospital(
        client,
        organisation,
        'break-glass-hospital',
        true,
      )
      const user = await createUser(
        client,
        'subject-break-glass-user',
        'break-glass-user@example.test',
      )
      const approver = await createUser(
        client,
        'subject-break-glass-approver',
        'break-glass-approver@example.test',
      )
      const reviewer = await createUser(
        client,
        'subject-break-glass-reviewer',
        'break-glass-reviewer@example.test',
      )

      await rejects(
        client,
        `insert into control.break_glass_grant
           (organisation_id, hospital_id, user_id, approved_by, reason, validity, approved_at)
         values (
           $1, $2, $3, $4, 'Emergency access',
           tstzrange(now() + interval '1 hour', now() + interval '3 hours', '[)'),
           now() + interval '2 hours'
         )`,
        [organisation, hospital, user, approver],
        '23514',
      )
      await rejects(
        client,
        `insert into control.break_glass_grant
           (organisation_id, hospital_id, user_id, approved_by, reason, validity)
         values ($1, $2, $3, $3, 'Self approval', tstzrange(now(), now() + interval '1 hour', '[)'))`,
        [organisation, hospital, user],
        '23514',
      )
      await rejects(
        client,
        `insert into control.break_glass_grant
           (organisation_id, hospital_id, user_id, reason, validity)
         values ($1, $2, $3, 'Too long', tstzrange(now(), now() + interval '5 hours', '[)'))`,
        [organisation, hospital, user],
        '23514',
      )

      const grant = await client.query<{ id: string }>(
        `insert into control.break_glass_grant
           (organisation_id, hospital_id, user_id, approval_mode, reason, validity)
         values ($1, $2, $3, 'emergency', 'Emergency access', tstzrange(now(), now() + interval '2 hours', '[)'))
         returning id`,
        [organisation, hospital, user],
      )
      const grantId = grant.rows[0]!.id

      await rejects(
        client,
        `update control.break_glass_grant
            set status = 'active', activated_at = now(), activated_by = $2
          where id = $1`,
        [grantId, approver],
        '23514',
      )
      await client.query(
        `update control.break_glass_grant
            set status = 'active', activated_at = now(), activated_by = $2
          where id = $1`,
        [grantId, user],
      )

      const past = await client.query<{ id: string }>(
        `insert into control.break_glass_grant
           (organisation_id, hospital_id, user_id, approved_by, reason,
            validity, approved_at, status, activated_at, activated_by, expired_at)
         values (
           $1, $2, $3, $4, 'Closed access',
           tstzrange(now() - interval '2 hours', now() - interval '1 hour', '[)'),
           now() - interval '3 hours', 'expired', now() - interval '2 hours', $3,
           now() - interval '1 hour'
         )
         returning id`,
        [organisation, hospital, user, approver],
      )
      const pastId = past.rows[0]!.id

      for (const independentReviewer of [user, approver]) {
        await rejects(
          client,
          `insert into control.break_glass_review (grant_id, reviewer_id, decision)
           values ($1, $2, 'upheld')`,
          [pastId, independentReviewer],
          '23514',
        )
      }
      await rejects(
        client,
        `update control.break_glass_grant set status = 'expired', expired_at = now()
          where id = $1`,
        [grantId],
        '23514',
      )
      await rejects(
        client,
        `insert into control.break_glass_review (grant_id, reviewer_id, reviewed_at, decision)
         values ($1, $2, now() + interval '1 hour', 'upheld')`,
        [pastId, reviewer],
        '23514',
      )
      await client.query(
        `insert into control.break_glass_review (grant_id, reviewer_id, decision)
         values ($1, $2, 'upheld')`,
        [pastId, reviewer],
      )
      await rejects(
        client,
        `insert into control.break_glass_review (grant_id, reviewer_id, decision)
         values ($1, $2, 'overturned')`,
        [pastId, reviewer],
        '23505',
      )
    })
  })

  test('keeps identity links and granted scope immutable', async () => {
    await withTransaction(ownerPool, async (client) => {
      const organisation = await createOrganisation(client, 'immutable-links')
      const hospital = await createHospital(
        client,
        organisation,
        'immutable-hospital',
        true,
      )
      const otherHospital = await createHospital(
        client,
        organisation,
        'immutable-other-hospital',
        true,
      )
      const user = await createUser(
        client,
        'subject-immutable-user',
        'immutable-user@example.test',
      )
      const approver = await createUser(
        client,
        'subject-immutable-approver',
        'immutable-approver@example.test',
      )

      await rejects(
        client,
        'update identity.app_user set zitadel_sub = $1 where id = $2',
        ['subject-replaced', user],
        '23514',
      )

      const invitation = await createInvitation(
        client,
        'immutable-invitee@example.test',
        organisation,
        hospital,
        user,
      )
      await rejects(
        client,
        'update identity.invitation set hospital_id = $1 where id = $2',
        [otherHospital, invitation],
        '23514',
      )
      await rejects(
        client,
        'update identity.invitation set email = $1 where id = $2',
        ['other-invitee@example.test', invitation],
        '23514',
      )

      const grant = await client.query<{ id: string }>(
        `insert into control.break_glass_grant
           (organisation_id, hospital_id, user_id, approved_by, reason, validity)
         values (
           $1, $2, $3, $4, 'Emergency access',
           tstzrange(now() + interval '1 hour', now() + interval '3 hours', '[)')
         )
         returning id`,
        [organisation, hospital, user, approver],
      )
      const grantId = grant.rows[0]!.id

      await rejects(
        client,
        `update control.break_glass_grant
            set validity = tstzrange(
              now() + interval '1 hour',
              now() + interval '5 hours',
              '[)'
            )
          where id = $1`,
        [grantId],
        '23514',
      )
      await rejects(
        client,
        'update control.break_glass_grant set user_id = $1 where id = $2',
        [approver, grantId],
        '23514',
      )
    })
  })

  test('constrains login attempts and web sessions', async () => {
    await withTransaction(ownerPool, async (client) => {
      const user = await createUser(
        client,
        'subject-session-user',
        'session-user@example.test',
      )

      await rejects(
        client,
        `insert into identity.login_attempt
           (state_hash, nonce_hash, pkce_verifier_ciphertext, key_version, return_to, purpose, expires_at)
         values ($1, $2, $3, 1, '/dashboard', 'step_up', now() + interval '10 minutes')`,
        [randomBytes(32), randomBytes(32), randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.login_attempt
           (user_id, state_hash, nonce_hash, pkce_verifier_ciphertext, key_version, return_to, purpose, expires_at)
         values ($1, $2, $3, $4, 1, '/dashboard', 'login', now() + interval '10 minutes')`,
        [user, randomBytes(32), randomBytes(32), randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.login_attempt
           (state_hash, nonce_hash, pkce_verifier_ciphertext, key_version, return_to, purpose, expires_at)
         values ($1, $2, $3, 1, '//evil.example', 'login', now() + interval '10 minutes')`,
        [randomBytes(32), randomBytes(32), randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.login_attempt
           (state_hash, nonce_hash, pkce_verifier_ciphertext, key_version, return_to, purpose, expires_at)
         values ($1, $2, $3, 1, '/a\\b', 'login', now() + interval '10 minutes')`,
        [randomBytes(32), randomBytes(32), randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.login_attempt
           (state_hash, nonce_hash, pkce_verifier_ciphertext, key_version, return_to, purpose, expires_at)
         values ($1, $2, $3, 1, '/dashboard', 'login', now() - interval '1 minute')`,
        [randomBytes(32), randomBytes(32), randomBytes(32)],
        '23514',
      )

      const attempt = await client.query<{ id: string }>(
        `insert into identity.login_attempt
           (state_hash, nonce_hash, pkce_verifier_ciphertext, key_version, return_to, purpose, expires_at)
         values ($1, $2, $3, 1, '/dashboard', 'login', now() + interval '10 minutes')
         returning id`,
        [randomBytes(32), randomBytes(32), randomBytes(32)],
      )
      expect(attempt.rows[0]?.id).toBeTruthy()

      const session = await client.query<{ id: string }>(
        `insert into identity.web_session
           (user_id, identity_issuer, token_hash, amr, auth_time, aal, idle_expires_at, absolute_expires_at)
         values ($1, 'http://localhost:8080', $2, array['pwd'], now(), 1, now() + interval '15 minutes', now() + interval '8 hours')
         returning id`,
        [user, randomBytes(32)],
      )
      const sessionId = session.rows[0]?.id
      if (!sessionId) throw new Error('session was not created')

      await client.query(
        `update identity.web_session
            set last_seen_at = now(), idle_expires_at = now() + interval '20 minutes'
          where id = $1`,
        [sessionId],
      )
      await rejects(
        client,
        `update identity.web_session
            set absolute_expires_at = now() + interval '9 hours'
          where id = $1`,
        [sessionId],
        '23514',
      )
      await rejects(
        client,
        `update identity.web_session
            set aal = 2
          where id = $1`,
        [sessionId],
        '23514',
      )
      await rejects(
        client,
        `update identity.web_session
            set amr = array['pwd', 'mfa']
          where id = $1`,
        [sessionId],
        '23514',
      )
      await rejects(
        client,
        `update identity.web_session
            set token_hash = $2
          where id = $1`,
        [sessionId, randomBytes(32)],
        '23514',
      )
      await client.query(
        `update identity.web_session
            set revoked_at = now(), revoke_reason = 'test logout'
          where id = $1`,
        [sessionId],
      )
      await rejects(
        client,
        'update identity.web_session set revoked_at = null where id = $1',
        [sessionId],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.web_session
           (user_id, identity_issuer, token_hash, amr, auth_time, aal, idle_expires_at, absolute_expires_at)
         values ($1, 'http://localhost:8080', $2, array['pwd'], now(), 1, now() + interval '9 hours', now() + interval '8 hours')`,
        [user, randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.web_session
           (user_id, identity_issuer, token_hash, amr, auth_time, aal, idle_expires_at, absolute_expires_at)
         values ($1, 'http://localhost:8080', $2, array[]::text[], now(), 1, now() + interval '15 minutes', now() + interval '8 hours')`,
        [user, randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.web_session
           (user_id, identity_issuer, token_hash, amr, auth_time, aal, last_seen_at, idle_expires_at, absolute_expires_at)
         values ($1, 'http://localhost:8080', $2, array['pwd'], now(), 1, now() + interval '20 minutes', now() + interval '15 minutes', now() + interval '8 hours')`,
        [user, randomBytes(32)],
        '23514',
      )
      await rejects(
        client,
        `insert into identity.web_session
           (user_id, identity_issuer, token_hash, amr, auth_time, aal, idle_expires_at, absolute_expires_at)
         values ($1, 'http://localhost:8080', $2, array['pwd'], now(), 1, now() + interval '15 minutes', now() + interval '8 hours')`,
        [user, randomBytes(31)],
        '23514',
      )
    })
  })

  test('limits audit metadata', async () => {
    await withTransaction(ownerPool, async (client) => {
      await rejects(
        client,
        `insert into audit.event (actor_type, event_type, outcome, metadata)
         values ('system', 'auth.login', 'success', $1::jsonb)`,
        ['[]'],
        '23514',
      )
      await rejects(
        client,
        `insert into audit.event (actor_type, event_type, outcome, metadata)
         values ('system', 'auth.login', 'success', $1::jsonb)`,
        [JSON.stringify({ session_id: 'x'.repeat(9_000) })],
        '23514',
      )
      await rejects(
        client,
        `insert into audit.event (actor_type, event_type, outcome, metadata)
         values ('system', 'auth.login', 'success', $1::jsonb)`,
        [JSON.stringify({ patient_name: 'Jane Doe' })],
        '23514',
      )
      await createAudit(client, { session_id: 'ok' })
    })
  })

  test('requires catalogued audit events, reasons and metadata keys', async () => {
    await withTransaction(ownerPool, async (client) => {
      await rejects(
        client,
        `insert into audit.event (actor_type, event_type, outcome)
         values ('system', 'unknown.event', 'success')`,
        [],
        '23503',
      )
      await rejects(
        client,
        `insert into audit.event (actor_type, event_type, outcome)
         values ('system', 'session.revoke', 'success')`,
        [],
        '23514',
      )
      await rejects(
        client,
        `insert into audit.event
           (actor_type, event_type, outcome, metadata)
         values ('system', 'session.revoke', 'success', '{"patient_name":"Jane Doe"}')`,
        [],
        '23514',
      )
      await client.query(
        `insert into audit.event
           (actor_type, event_type, outcome, reason_code, metadata)
         values ('system', 'session.revoke', 'success', 'user_logout', '{"session_id":"s"}')`,
      )
    })
  })

  test('seeds permissions, system roles and templates idempotently', async () => {
    const seed = await Bun.file(
      new URL('../../../migrations/007_seed.sql', import.meta.url),
    ).text()
    const up = seed.split('-- Down Migration')[0]
    if (!up) throw new Error('seed migration has no Up section')

    await ownerPool.query(up)
    await ownerPool.query(up)

    const roles = await ownerPool.query<{ key: string }>(
      `select key from control.role
       where organisation_id is null
       order by key`,
    )
    const permissions = await ownerPool.query<{ key: string }>(
      'select key from control.permission order by key',
    )
    const templates = await ownerPool.query<{ key: string }>(
      'select key from control.role_template order by key',
    )
    const links = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from control.role_template_permission',
    )
    const versions = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from control.role_template_version',
    )
    const events = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from audit.event_type',
    )

    expect(roles.rows.map((row) => row.key)).toEqual([
      'break_glass_approver',
      'platform_admin',
    ])
    expect(permissions.rows).toHaveLength(9)
    expect(templates.rows.map((row) => row.key)).toEqual([
      'auditor',
      'clinician',
      'hospital_admin',
      'org_admin',
    ])
    expect(links.rows[0]!.count).toBe(13)
    expect(versions.rows[0]!.count).toBe(4)
    expect(events.rows[0]!.count).toBe(11)
  })
})

describe('app user repository', () => {
  test('upserts a user by subject and never reactivates a deactivated user', async () => {
    const users = new AppUserRepository(appPool)
    const first = await users.upsertFromIdentity({
      identityIssuer: 'http://localhost:8080',
      zitadelSubject: 'repository-user-1',
      email: 'repository.one@example.test',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      displayName: 'Repository One',
      homeOrganisationId: null,
    })

    const second = await users.upsertFromIdentity({
      identityIssuer: 'http://localhost:8080',
      zitadelSubject: 'repository-user-1',
      email: 'repository.one.changed@example.test',
      emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
      displayName: 'Repository One Changed',
      homeOrganisationId: null,
    })

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toEqual(first.createdAt)
    expect(second.email).toBe('repository.one.changed@example.test')
    expect(second.displayName).toBe('Repository One Changed')

    const deactivated = await users.setStatus(first.id, 'deactivated')
    expect(deactivated?.status).toBe('deactivated')

    const afterLogin = await users.upsertFromIdentity({
      identityIssuer: 'http://localhost:8080',
      zitadelSubject: 'repository-user-1',
      email: 'repository.one.changed@example.test',
      emailVerifiedAt: new Date('2026-01-03T00:00:00.000Z'),
      displayName: 'Repository One Changed',
      homeOrganisationId: null,
    })
    expect(afterLogin.status).toBe('deactivated')

    const loginAt = new Date(Date.now() + 60_000)
    expect(await users.markLogin(first.id, loginAt)).toBeNull()

    await users.setStatus(first.id, 'active')
    const marked = await users.markLogin(first.id, loginAt)
    expect(marked?.lastLoginAt).toEqual(loginAt)
    expect(await users.findBySubject('http://localhost:8080', 'repository-user-1')).toEqual(
      marked,
    )

    const clamped = await users.markLogin(first.id, new Date('2000-01-01T00:00:00.000Z'))
    expect(clamped?.lastLoginAt).toEqual(clamped?.createdAt)
  })

  test('rejects a second identity that claims the same email', async () => {
    const users = new AppUserRepository(appPool)
    await users.upsertFromIdentity({
      identityIssuer: 'http://localhost:8080',
      zitadelSubject: 'repository-user-2',
      email: 'repository.two@example.test',
      emailVerifiedAt: null,
      displayName: 'Repository Two',
      homeOrganisationId: null,
    })

    await expect(
      users.upsertFromIdentity({
        identityIssuer: 'http://localhost:8080',
        zitadelSubject: 'repository-user-3',
        email: 'repository.two@example.test',
        emailVerifiedAt: null,
        displayName: 'Repository Three',
        homeOrganisationId: null,
      }),
    ).rejects.toBeInstanceOf(AppUserEmailConflictError)
  })
})

describe('session repository', () => {
  test('stores sessions by hash and revokes them conditionally', async () => {
    const userId = await createUser(ownerPool, 'repository-session-user', 'session@example.test')
    const sessions = new SessionRepository(appPool)
    const now = new Date()
    const created = await sessions.create({
      userId,
      identityIssuer: 'http://localhost:8080',
      tokenHash: randomBytes(32),
      zitadelSessionId: 'zitadel-session',
      oidcSid: 'oidc-sid',
      acr: 'urn:zitadel:iam:org:project:id:test:aud',
      idTokenHintCiphertext: Buffer.from('sealed-hint'),
      keyVersion: 1,
      amr: ['pwd'],
      authTime: new Date(now.getTime() - 60_000),
      aal: 1,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
      ip: '127.0.0.1',
      userAgentHash: randomBytes(32),
    })

    expect(await sessions.findByTokenHash(created.tokenHash)).toEqual(created)
    expect(await sessions.findByTokenHash(randomBytes(32))).toBeNull()

    const touchedAt = new Date(now.getTime() + 60_000)
    const idle = new Date(touchedAt.getTime() + 15 * 60_000)
    expect(await sessions.touch(created.id, touchedAt, idle)).toBe(true)
    expect((await sessions.findById(created.id))?.lastSeenAt).toEqual(touchedAt)

    expect(await sessions.revoke(created.id, touchedAt, 'logout')).toBe(true)
    expect(await sessions.revoke(created.id, touchedAt, 'logout')).toBe(false)
    expect(await sessions.touch(created.id, touchedAt, idle)).toBe(false)
    expect((await sessions.findById(created.id))?.revokeReason).toBe('logout')
  })

  test('revokes every live session for one user', async () => {
    const userId = await createUser(ownerPool, 'repository-revoke-all', 'revoke-all@example.test')
    const sessions = new SessionRepository(appPool)
    const now = new Date()

    for (let index = 0; index < 2; index += 1) {
      await sessions.create({
        userId,
        identityIssuer: 'http://localhost:8080',
        tokenHash: randomBytes(32),
        zitadelSessionId: null,
        oidcSid: null,
        acr: null,
        idTokenHintCiphertext: null,
        keyVersion: null,
        amr: ['pwd'],
        authTime: new Date(now.getTime() - 60_000),
        aal: 1,
        idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        ip: null,
        userAgentHash: null,
      })
    }

    const revokedAt = new Date()
    expect(await sessions.revokeAllForUser(userId, revokedAt, 'account_suspended')).toBe(2)
    expect(await sessions.revokeAllForUser(userId, revokedAt, 'account_suspended')).toBe(0)
  })
})

describe('audit writer', () => {
  test('appends catalogued events with allowed metadata', async () => {
    const actorId = await createUser(ownerPool, 'audit-writer-user', 'audit.writer@example.test')
    const events = new AuditWriter(appPool)

    await events.write({
      actorUserId: actorId,
      actorType: 'user',
      sessionId: null,
      organisationId: null,
      hospitalId: null,
      eventType: 'auth.login',
      outcome: 'success',
      requestId: 'req-1',
      metadata: { session_id: 'session-1' },
    })

    await events.write({
      actorUserId: actorId,
      actorType: 'user',
      sessionId: null,
      organisationId: null,
      hospitalId: null,
      eventType: 'session.revoke',
      outcome: 'success',
      reason: 'User logged out.',
      reasonCode: 'user_logout',
      metadata: { session_id: 'session-1', reason_code: 'user_logout' },
    })

    const count = await ownerPool.query<{ count: number }>(
      `select count(*)::int as count
         from audit.event
        where actor_user_id = $1`,
      [actorId],
    )
    expect(count.rows[0]!.count).toBe(2)
  })

  test('fails closed on an unknown event, missing reason and forbidden metadata', async () => {
    const actorId = await createUser(ownerPool, 'audit-writer-denied', 'audit.denied@example.test')
    const events = new AuditWriter(appPool)

    await expect(
      events.write({
        actorUserId: actorId,
        actorType: 'user',
        sessionId: null,
        organisationId: null,
        hospitalId: null,
        eventType: 'unknown.event',
        outcome: 'success',
      }),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      events.write({
        actorUserId: actorId,
        actorType: 'user',
        sessionId: null,
        organisationId: null,
        hospitalId: null,
        eventType: 'session.revoke',
        outcome: 'success',
        metadata: { session_id: 'session-1' },
      }),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      events.write({
        actorUserId: actorId,
        actorType: 'user',
        sessionId: null,
        organisationId: null,
        hospitalId: null,
        eventType: 'session.revoke',
        outcome: 'success',
        reasonCode: 'user_logout',
        metadata: { session_id: 'session-1', patient_name: 'Jane Doe' },
      }),
    ).rejects.toMatchObject({ code: '23514' })
  })
})


function loginAttempt(now: Date): LoginAttempt {
  return {
    id: 'attempt-1',
    userId: null,
    stateHash: randomBytes(32),
    nonceHash: randomBytes(32),
    pkceVerifierCiphertext: Buffer.from('sealed-verifier'),
    keyVersion: 1,
    returnTo: '/dashboard',
    purpose: 'login',
    ip: null,
    userAgentHash: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 600_000),
    consumedAt: now,
  }
}

function identityFor(
  email: string,
  subject: string,
  now: Date,
): VerifiedIdentity {
  return {
    issuer: 'http://localhost:8080',
    subject,
    email,
    emailVerifiedAt: now,
    displayName: 'Login Store User',
    authTime: new Date(now.getTime() - 60_000),
    amr: ['pwd'],
    aal: 1,
    sid: 'zitadel-session-1',
    acr: null,
    idToken: 'signed.id.token',
  }
}

describe('login completion store', () => {
  test('accepts an invitation and mints a session in one transaction', async () => {
    const organisation = await createOrganisation(ownerPool, 'login-store')
    const inviter = await createUser(ownerPool, 'login-inviter', 'inviter@example.test')
    const role = await createRole(ownerPool, organisation, 'login_clinician', 'organisation')
    await ownerPool.query(
      "insert into control.role_permission (role_id, permission_key) values ($1, 'clinical.read')",
      [role],
    )
    const invitation = await createInvitation(
      ownerPool,
      'invitee.login@example.test',
      organisation,
      null,
      inviter,
    )
    await ownerPool.query(
      'insert into control.invitation_role (invitation_id, role_id) values ($1, $2)',
      [invitation, role],
    )

    const now = new Date(Date.now() + 1_000)
    const result = await new PostgresLoginStore(appPool).complete({
      attempt: loginAttempt(now),
      identity: identityFor('invitee.login@example.test', 'login-invitee', now),
      idTokenHintCiphertext: Buffer.from('sealed-hint'),
      keyVersion: 1,
      now,
      ip: '127.0.0.1',
      userAgentHash: null,
      requestId: 'login-request-1',
    })

    expect(result.token).toHaveLength(43)
    expect(result.returnTo).toBe('/dashboard')

    const user = await ownerPool.query<{ id: string; home_organisation_id: string }>(
      'select id, home_organisation_id from identity.app_user where zitadel_sub = $1',
      ['login-invitee'],
    )
    expect(user.rows[0]!.home_organisation_id).toBe(organisation)
    const userId = user.rows[0]!.id

    const accepted = await ownerPool.query<{ status: string; accepted_by_user_id: string }>(
      'select status, accepted_by_user_id from identity.invitation where id = $1',
      [invitation],
    )
    expect(accepted.rows[0]!.status).toBe('accepted')
    expect(accepted.rows[0]!.accepted_by_user_id).toBe(userId)

    const membership = await ownerPool.query<{ id: string; hospital_id: string | null }>(
      'select id, hospital_id from control.membership where user_id = $1',
      [userId],
    )
    expect(membership.rowCount).toBe(1)
    expect(membership.rows[0]!.hospital_id).toBeNull()

    const assigned = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from control.membership_role where membership_id = $1 and role_id = $2',
      [membership.rows[0]!.id, role],
    )
    expect(assigned.rows[0]!.count).toBe(1)

    const audit = await ownerPool.query<{ count: number }>(
      "select count(*)::int as count from audit.event where actor_user_id = $1 and event_type in ('auth.login', 'invitation.accept')",
      [userId],
    )
    expect(audit.rows[0]!.count).toBe(2)

    const access = await new AccessRepository(appPool).listForUser(
      userId,
      new Date(now.getTime() + 1_000),
    )
    expect(access.memberships).toHaveLength(1)
    expect(access.memberships[0]!.organisationId).toBe(organisation)
    expect(access.memberships[0]!.roles).toEqual(['login_clinician'])
    expect(access.permissions).toEqual(['clinical.read'])
  })

  test('rotates the session and records a step-up', async () => {
    const user = await createUser(ownerPool, 'step-up-user', 'step-up@example.test')
    const now = new Date(Date.now() + 1_000)
    const sessions = new SessionService({
      store: new SessionRepository(appPool),
      clock: () => now,
    })
    const issued = await sessions.mint({
      userId: user,
      identityIssuer: 'http://localhost:8080',
      zitadelSessionId: null,
      oidcSid: 'sid-before',
      acr: null,
      idTokenHintCiphertext: Buffer.from('sealed-hint-before'),
      keyVersion: 1,
      amr: ['pwd'],
      authTime: new Date(now.getTime() - 60_000),
      aal: 1,
      ip: null,
      userAgentHash: null,
    })

    const result = await new PostgresLoginStore(appPool).completeStepUp({
      attempt: {
        ...loginAttempt(now),
        id: 'step-up-attempt',
        userId: user,
        purpose: 'step_up',
        returnTo: '/settings',
      },
      identity: {
        ...identityFor('step-up@example.test', 'step-up-user', now),
        amr: ['pwd', 'hwk'],
        aal: 3,
        authTime: new Date(now.getTime() - 1_000),
      },
      idTokenHintCiphertext: Buffer.from('sealed-hint-after'),
      keyVersion: 1,
      now,
      ip: '127.0.0.1',
      userAgentHash: null,
      requestId: 'step-up-request',
      sessionToken: issued.token,
    })

    expect(result.token).not.toBe(issued.token)
    expect(result.returnTo).toBe('/settings')

    const previous = await sessions.findByToken(issued.token)
    expect(previous?.revokedAt).toEqual(now)
    expect(previous?.revokeReason).toBe('rotated')

    const next = await sessions.findByToken(result.token)
    expect(next?.userId).toBe(user)
    expect(next?.aal).toBe(3)
    expect(next?.amr).toEqual(['pwd', 'hwk'])
    expect(next?.authTime).toEqual(new Date(now.getTime() - 1_000))

    const audit = await ownerPool.query<{ count: number }>(
      "select count(*)::int as count from audit.event where actor_user_id = $1 and event_type = 'auth.step_up'",
      [user],
    )
    expect(audit.rows[0]!.count).toBe(1)
  })

  test('refuses to rotate a session that belongs to another user', async () => {
    const owner = await createUser(ownerPool, 'step-up-owner', 'step-up-owner@example.test')
    const other = await createUser(ownerPool, 'step-up-other', 'step-up-other@example.test')
    const now = new Date(Date.now() + 1_000)
    const sessions = new SessionService({
      store: new SessionRepository(appPool),
      clock: () => now,
    })
    const issued = await sessions.mint({
      userId: owner,
      identityIssuer: 'http://localhost:8080',
      zitadelSessionId: null,
      oidcSid: null,
      acr: null,
      idTokenHintCiphertext: null,
      keyVersion: null,
      amr: ['pwd'],
      authTime: new Date(now.getTime() - 1_000),
      aal: 1,
      ip: null,
      userAgentHash: null,
    })

    await expect(
      new PostgresLoginStore(appPool).completeStepUp({
        attempt: {
          ...loginAttempt(now),
          id: 'step-up-other-attempt',
          userId: other,
          purpose: 'step_up',
        },
        identity: identityFor('step-up-other@example.test', 'step-up-other', now),
        idTokenHintCiphertext: Buffer.from('sealed-hint-after'),
        keyVersion: 1,
        now,
        ip: null,
        userAgentHash: null,
        requestId: null,
        sessionToken: issued.token,
      }),
    ).rejects.toBeInstanceOf(LoginRejectedError)

    const stillActive = await sessions.findByToken(issued.token)
    expect(stillActive?.revokedAt).toBeNull()
  })

  test('rejects a suspended user and creates no session', async () => {
    const user = await createUser(ownerPool, 'login-suspended', 'suspended.login@example.test')
    await ownerPool.query("update identity.app_user set status = 'suspended' where id = $1", [user])
    const now = new Date(Date.now() + 1_000)

    await expect(
      new PostgresLoginStore(appPool).complete({
        attempt: loginAttempt(now),
        identity: identityFor('suspended.login@example.test', 'login-suspended', now),
        idTokenHintCiphertext: Buffer.from('sealed-hint'),
        keyVersion: 1,
        now,
        ip: null,
        userAgentHash: null,
        requestId: null,
      }),
    ).rejects.toBeInstanceOf(LoginRejectedError)

    const sessions = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from identity.web_session where user_id = $1',
      [user],
    )
    expect(sessions.rows[0]!.count).toBe(0)
  })

  test('ignores an expired invitation', async () => {
    const organisation = await createOrganisation(ownerPool, 'login-expired')
    const inviter = await createUser(ownerPool, 'login-expired-inviter', 'expired.inviter@example.test')
    await createInvitation(
      ownerPool,
      'expired.invitee@example.test',
      organisation,
      null,
      inviter,
      -120,
      -60,
    )
    const now = new Date(Date.now() + 1_000)

    const result = await new PostgresLoginStore(appPool).complete({
      attempt: loginAttempt(now),
      identity: identityFor('expired.invitee@example.test', 'login-expired-invitee', now),
      idTokenHintCiphertext: Buffer.from('sealed-hint'),
      keyVersion: 1,
      now,
      ip: null,
      userAgentHash: null,
      requestId: null,
    })

    const membership = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from control.membership where user_id = $1',
      [result.userId],
    )
    expect(membership.rows[0]!.count).toBe(0)
  })

  test('does not auto-accept an invitation for an existing user', async () => {
    const organisation = await createOrganisation(ownerPool, 'login-existing')
    const inviter = await createUser(ownerPool, 'login-existing-inviter', 'existing.inviter@example.test')
    await createUser(ownerPool, 'login-existing-invitee', 'existing.invitee@example.test')
    const invitation = await createInvitation(
      ownerPool,
      'existing.invitee@example.test',
      organisation,
      null,
      inviter,
      0,
      60,
      'existing_user',
      'login-existing-invitee',
    )
    const now = new Date(Date.now() + 1_000)

    const result = await new PostgresLoginStore(appPool).complete({
      attempt: loginAttempt(now),
      identity: identityFor('existing.invitee@example.test', 'login-existing-invitee', now),
      idTokenHintCiphertext: Buffer.from('sealed-hint'),
      keyVersion: 1,
      now,
      ip: null,
      userAgentHash: null,
      requestId: null,
    })

    const pending = await ownerPool.query<{ status: string }>(
      'select status from identity.invitation where id = $1',
      [invitation],
    )
    expect(pending.rows[0]!.status).toBe('pending')
    const membership = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from control.membership where user_id = $1',
      [result.userId],
    )
    expect(membership.rows[0]!.count).toBe(0)
  })
})

describe('invitation service', () => {
  function invitationService(sent: { token: string | null }): InvitationService {
    const zitadel = new ZitadelManagementClient(
      'http://localhost:8080',
      { token: async () => 'service-token' },
    )
    return new InvitationService({
      pool: appPool,
      invitations: new InvitationRepository(appPool),
      organisations: new OrganisationRepository(appPool),
      hospitals: new HospitalRepository(appPool),
      memberships: new MembershipAdminRepository(appPool),
      users: new AppUserRepository(appPool),
      authorization: new AuthorizationRepository(appPool),
      zitadel,
      audit: new AuditWriter(appPool),
      mailer: {
        async send(input) {
          sent.token = input.token
        },
      },
    })
  }

  test('accepts an existing-user invitation once and rejects a different session', async () => {
    const organisation = await createOrganisation(ownerPool, 'invitation-service')
    const inviterId = await createUser(ownerPool, 'invite-issuer', 'issuer@example.test')
    const inviteeId = await createUser(ownerPool, 'invite-target', 'target@example.test')
    const role = await createRole(ownerPool, organisation, 'invite_manager', 'organisation')
    await ownerPool.query(
      "insert into control.role_permission (role_id, permission_key) values ($1, 'membership.manage')",
      [role],
    )
    const inviterMembership = await createMembership(
      ownerPool,
      inviterId,
      organisation,
      null,
      -5,
      60,
    )
    await ownerPool.query(
      "insert into control.membership_role (membership_id, role_id, validity) values ($1, $2, tstzrange(now(), now() + interval '30 minutes'))",
      [inviterMembership, role],
    )
    const inviter = await new AppUserRepository(ownerPool).findById(inviterId)
    const invitee = await new AppUserRepository(ownerPool).findById(inviteeId)
    expect(inviter).not.toBeNull()
    expect(invitee).not.toBeNull()

    const sent: { token: string | null } = { token: null }
    const service = invitationService(sent)
    const invitation = await service.create(
      {
        actor: inviter!,
        sessionId: randomUUID(),
        requestId: 'request-invite',
        ip: null,
        userAgentHash: null,
      },
      {
        email: 'target@example.test',
        organisationId: organisation,
        roleIds: [role],
      },
    )
    expect(invitation.kind).toBe('existing_user')
    expect(sent.token).not.toBeNull()

    const wrongActor = await service.accept(
      {
        actor: inviter!,
        sessionId: randomUUID(),
        requestId: 'request-accept',
        ip: null,
        userAgentHash: null,
      },
      sent.token!,
    ).catch((error: unknown) => error)
    expect(wrongActor).toBeInstanceOf(AppError)
    expect((wrongActor as AppError).status).toBe(403)

    const accepted = await service.accept(
      {
        actor: invitee!,
        sessionId: randomUUID(),
        requestId: 'request-accept',
        ip: null,
        userAgentHash: null,
      },
      sent.token!,
    )
    expect(accepted.status).toBe('accepted')
    expect(accepted.acceptedByUserId).toBe(inviteeId)

    const membership = await ownerPool.query<{ count: number }>(
      'select count(*)::int as count from control.membership where user_id = $1 and organisation_id = $2',
      [inviteeId, organisation],
    )
    expect(membership.rows[0]!.count).toBe(1)

    const replay = await service.accept(
      {
        actor: invitee!,
        sessionId: randomUUID(),
        requestId: 'request-replay',
        ip: null,
        userAgentHash: null,
      },
      sent.token!,
    ).catch((error: unknown) => error)
    expect(replay).toBeInstanceOf(AppError)
    expect((replay as AppError).status).toBe(409)
  })
})

describe('admin routes', () => {
  function application() {
    const audit = new AuditWriter(appPool)
    const authorization = new AuthorizationRepository(appPool)
    const users = new AppUserRepository(appPool)
    const organisations = new OrganisationRepository(appPool)
    const hospitals = new HospitalRepository(appPool)
    const memberships = new MembershipAdminRepository(appPool)
    const invitations = new InvitationRepository(appPool)
    const sessions = new SessionService({ store: new SessionRepository(appPool) })
    const zitadel = new ZitadelManagementClient(
      'http://localhost:8080',
      { token: async () => 'service-token' },
    )
    const app = new Elysia().use(errors).use(
      createAdmin({
        organisations: new OrganisationAdminService(
          organisations,
          authorization,
          new OrganisationProvisioningService(appPool, zitadel, audit),
        ),
        hospitals: new HospitalAdminService(hospitals, organisations, authorization, audit),
        memberships: new MembershipAdminService(memberships, authorization, audit),
        invitations: new InvitationService({
          pool: appPool,
          invitations,
          organisations,
          hospitals,
          memberships,
          users,
          authorization,
          zitadel,
          audit,
          mailer: { async send() {} },
        }),
        audit: new AuditAdminService(new AuditReadRepository(appPool), authorization),
        sessions,
        users,
      }),
    )
    return { app, sessions }
  }

  test('rejects a missing session before any administration code runs', async () => {
    const { app } = application()
    const response = await app.handle(new Request('http://localhost/v1/admin/organisations'))
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_REQUIRED')
    expect(response.headers.get('x-request-id')).not.toBeNull()
  })

  test('allows a platform administrator to invite staff without a membership', async () => {
    const organisation = await createOrganisation(ownerPool, 'platform-invite')
    const role = await createRole(ownerPool, organisation, 'platform_invite_role', 'organisation')
    const invitee = await createUser(ownerPool, 'platform-invitee', 'platform-invitee@example.test')
    const platformRole = await findSystemRole(ownerPool, 'platform_admin')
    await ownerPool.query(
      'insert into control.platform_assignment (user_id, role_id) values ($1, $2)',
      [invitee, platformRole],
    )

    try {
      const { app, sessions } = application()
      const issued = await sessions.mint({
        userId: invitee,
        identityIssuer: 'http://localhost:8080',
        zitadelSessionId: null,
        oidcSid: null,
        acr: null,
        idTokenHintCiphertext: null,
        keyVersion: null,
        amr: ['pwd'],
        authTime: new Date(Date.now() - 60_000),
        aal: 1,
        ip: null,
        userAgentHash: null,
      })
      const response = await app.handle(
        new Request(`http://localhost/v1/admin/organisations/${organisation}/invitations`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${issued.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'platform-invitee@example.test',
            roleIds: [role],
          }),
        }),
      )
      expect(response.status).toBe(201)
      const body = await response.json() as { kind: string; email: string }
      expect(body.kind).toBe('existing_user')
      expect(body.email).toBe('platform-invitee@example.test')
    } finally {
      await ownerPool.query('delete from control.platform_assignment where user_id = $1', [invitee])
    }
  })

  test('rejects malformed route identifiers before the handler', async () => {
    const user = await createUser(ownerPool, 'malformed-id-user', 'malformed@example.test')
    const { app, sessions } = application()
    const issued = await sessions.mint({
      userId: user,
      identityIssuer: 'http://localhost:8080',
      zitadelSessionId: null,
      oidcSid: null,
      acr: null,
      idTokenHintCiphertext: null,
      keyVersion: null,
      amr: ['pwd'],
      authTime: new Date(Date.now() - 60_000),
      aal: 1,
      ip: null,
      userAgentHash: null,
    })
    const response = await app.handle(
      new Request('http://localhost/v1/admin/organisations/not-a-uuid/hospitals', {
        headers: { authorization: `Bearer ${issued.token}` },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  test('denies organisation creation without platform permission', async () => {
    const user = await createUser(ownerPool, 'admin-route-user', 'route@example.test')
    const { app, sessions } = application()
    const issued = await sessions.mint({
      userId: user,
      identityIssuer: 'http://localhost:8080',
      zitadelSessionId: null,
      oidcSid: null,
      acr: null,
      idTokenHintCiphertext: null,
      keyVersion: null,
      amr: ['pwd'],
      authTime: new Date(Date.now() - 60_000),
      aal: 1,
      ip: null,
      userAgentHash: null,
    })
    const response = await app.handle(
      new Request('http://localhost/v1/admin/organisations', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${issued.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Denied', slug: 'denied' }),
      }),
    )
    expect(response.status).toBe(403)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN')
    const created = await ownerPool.query<{ count: number }>(
      "select count(*)::int as count from control.organisation where slug = 'denied'",
    )
    expect(created.rows[0]!.count).toBe(0)
  })
})

describe('session access repository', () => {
  test('returns only current memberships and their permissions', async () => {
    const organisation = await createOrganisation(ownerPool, 'access-read')
    const hospital = await createHospital(ownerPool, organisation, 'access-hospital', true)
    const role = await createRole(ownerPool, organisation, 'access_clinician', 'hospital')
    await ownerPool.query(
      "insert into control.role_permission (role_id, permission_key) values ($1, 'clinical.read')",
      [role],
    )
    const user = await createUser(ownerPool, 'access-user', 'access@example.test')
    const membership = await createMembership(ownerPool, user, organisation, hospital, -5, 30)
    await ownerPool.query(
      "insert into control.membership_role (membership_id, role_id, validity) values ($1, $2, tstzrange(now(), now() + interval '29 minutes'))",
      [membership, role],
    )
    await createMembership(ownerPool, user, organisation, hospital, 60, 120)

    const access = await new AccessRepository(appPool).listForUser(user, new Date())
    expect(access.memberships).toHaveLength(1)
    expect(access.memberships[0]!.hospitalId).toBe(hospital)
    expect(access.memberships[0]!.roles).toEqual(['access_clinician'])
    expect(access.permissions).toEqual(['clinical.read'])
  })

  test('includes platform permissions without a membership', async () => {
    const user = await createUser(ownerPool, 'access-platform', 'platform@example.test')
    const role = await findSystemRole(ownerPool, 'platform_admin')
    await ownerPool.query(
      'insert into control.platform_assignment (user_id, role_id) values ($1, $2)',
      [user, role],
    )

    const access = await new AccessRepository(appPool).listForUser(user, new Date())
    expect(access.memberships).toEqual([])
    expect(access.permissions).toEqual(['platform.manage'])

    await ownerPool.query('delete from control.platform_assignment where user_id = $1', [user])
  })
})
