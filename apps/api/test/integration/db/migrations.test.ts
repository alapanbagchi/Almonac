/**
 * One suite owns the test database lifecycle: it resets the schema before the
 * tests and leaves the database empty afterwards. Keep the suite in one file
 * unless the reset moves into a serialized shared harness; parallel files would
 * race on the same database.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { migrateDatabase } from '../../../src/db/migrate'
import { CONTROL_RUNTIME_ROLE } from '../../../src/db/pool'
import {
  AppUserEmailConflictError,
  AppUserRepository,
} from '../../../src/identity/app-user-repository'
import { SessionRepository } from '../../../src/identity/session-repository'

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
  client: PoolClient,
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
  client: PoolClient,
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
  client: PoolClient,
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
  client: PoolClient,
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
  client: PoolClient,
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
  client: PoolClient,
  userId: string,
  organisationId: string,
  hospitalId: string | null,
  startMinutes = 0,
  endMinutes: number | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into control.membership
       (user_id, organisation_id, hospital_id, accepted_at, validity)
     values (
       $1,
       $2,
       $3,
       now() + $4::interval,
       tstzrange(
         now() + $4::interval,
         case when $5::interval is null then null else now() + $5::interval end,
         '[)'
       )
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
  client: PoolClient,
  email: string,
  organisationId: string,
  hospitalId: string | null,
  invitedBy: string,
  createdMinutes = 0,
  expiresMinutes = 60,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into identity.invitation
       (email, organisation_id, hospital_id, token_hash, kind, invited_by, created_at, expires_at)
     values ($1, $2, $3, $4, 'new_user', $5, now() + $6::interval, now() + $7::interval)
     returning id`,
    [
      email,
      organisationId,
      hospitalId,
      randomBytes(32),
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

    expect(result.rows[0]?.version).toBe(2)
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
          'update control.schema_metadata set version = 3 where id = 1',
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
    expect(events.rows[0]!.count).toBe(10)
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
    const marked = await users.markLogin(first.id, loginAt)
    expect(marked?.lastLoginAt).toEqual(loginAt)
    expect(await users.findBySubject('http://localhost:8080', 'repository-user-1')).toEqual(
      marked,
    )
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
