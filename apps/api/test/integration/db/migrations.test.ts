import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Pool, type PoolClient } from 'pg'
import { migrateDatabase } from '../../../src/db/migrate'

const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required. Start infrastructure/local and copy apps/api/.env.example to apps/api/.env.',
  )
}

const pool = new Pool({ connectionString: databaseUrl })

async function withTransaction(
  run: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await run(client)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

async function createOrganisation(client: PoolClient, slug: string) {
  const result = await client.query<{ id: string }>(
    `insert into control.organisation (zitadel_org_id, name, slug, provisioned_at)
     values ($1, $2, $3, now())
     returning id`,
    [`zitadel-${slug}`, slug, slug],
  )

  return result.rows[0]!.id
}

async function createHospital(
  client: PoolClient,
  organisationId: string,
  slug: string,
  domain: string,
) {
  const result = await client.query<{ id: string }>(
    `insert into control.hospital
       (organisation_id, name, slug, domain, domain_verified_at, timezone)
     values ($1, $2, $3, $4, now(), 'UTC')
     returning id`,
    [organisationId, slug, slug, domain],
  )

  return result.rows[0]!.id
}

async function createUser(client: PoolClient, subject: string, email: string) {
  const result = await client.query<{ id: string }>(
    `insert into identity.app_user (zitadel_sub, email)
     values ($1, $2)
     returning id`,
    [subject, email],
  )

  return result.rows[0]!.id
}

beforeAll(async () => {
  await migrateDatabase(databaseUrl, 'down', 1_000)
  await migrateDatabase(databaseUrl, 'up')
})

afterAll(async () => {
  await migrateDatabase(databaseUrl, 'down', 1_000)
  await pool.end()
})

describe('control database migrations', () => {
  test('creates the control, identity and audit tables', async () => {
    const result = await pool.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name
       from information_schema.tables
       where table_schema in ('identity', 'control')
       order by table_schema, table_name`,
    )

    const tables = result.rows.map((row) => `${row.table_schema}.${row.table_name}`)

    expect(tables).toContain('identity.app_user')
    expect(tables).toContain('identity.login_attempt')
    expect(tables).toContain('identity.web_session')
    expect(tables).toContain('identity.invitation')
    expect(tables).toContain('identity.audit_event')
    expect(tables).toContain('control.organisation')
    expect(tables).toContain('control.hospital')
    expect(tables).toContain('control.membership')
    expect(tables).toContain('control.role')
    expect(tables).toContain('control.permission')
    expect(tables).toContain('control.role_permission')
    expect(tables).toContain('control.membership_role')
    expect(tables).toContain('control.break_glass_grant')
  })

  test('rejects mixed-case and duplicate user emails', async () => {
    await withTransaction(async (client) => {
      await createUser(client, 'subject-1', 'first@example.test')

      await expect(
        client.query(
          'insert into identity.app_user (zitadel_sub, email) values ($1, $2)',
          ['subject-2', 'second@example.test'],
        ),
      ).resolves.toBeDefined()

      await expect(
        client.query(
          'insert into identity.app_user (zitadel_sub, email) values ($1, $2)',
          ['subject-3', 'Mixed@Example.test'],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })

    await withTransaction(async (client) => {
      await createUser(client, 'subject-4', 'duplicate@example.test')

      await expect(
        client.query(
          'insert into identity.app_user (zitadel_sub, email) values ($1, $2)',
          ['subject-5', 'duplicate@example.test'],
        ),
      ).rejects.toMatchObject({ code: '23505' })
    })
  })

  test('rejects a malformed hospital domain', async () => {
    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'domain-format')

      await expect(
        createHospital(
          client,
          organisation,
          'domain-hospital',
          'bad-.example.test',
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  test('rejects an update or delete of an audit event', async () => {
    await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into identity.audit_event (actor_type, event_type, outcome)
         values ('system', 'test.event', 'success')
         returning id`,
      )

      const id = inserted.rows[0]!.id

      await expect(
        client.query('update identity.audit_event set outcome = $1 where id = $2', [
          'failure',
          id,
        ]),
      ).rejects.toMatchObject({ code: '55000' })
    })

    await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into identity.audit_event (actor_type, event_type, outcome)
         values ('system', 'test.event', 'success')
         returning id`,
      )

      await expect(
        client.query('delete from identity.audit_event where id = $1', [
          inserted.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({ code: '55000' })
    })
  })

  test('rejects truncation of audit events', async () => {
    await withTransaction(async (client) => {
      await expect(
        client.query('truncate identity.audit_event'),
      ).rejects.toMatchObject({ code: '55000' })
    })
  })

  test('rejects a role from another organisation', async () => {
    await withTransaction(async (client) => {
      const firstOrg = await createOrganisation(client, 'first-org')
      const secondOrg = await createOrganisation(client, 'second-org')
      const hospital = await createHospital(
        client,
        firstOrg,
        'first-hospital',
        'first.example.test',
      )
      const user = await createUser(client, 'subject-6', 'member@example.test')

      const membership = await client.query<{ id: string }>(
        `insert into control.membership
           (user_id, organisation_id, hospital_id, status, starts_at, accepted_at)
         values ($1, $2, $3, 'active', now(), now())
         returning id`,
        [user, firstOrg, hospital],
      )

      const role = await client.query<{ id: string }>(
        `insert into control.role (organisation_id, key, name, scope)
         values ($1, 'clinician', 'Clinician', 'organisation')
         returning id`,
        [secondOrg],
      )

      await expect(
        client.query(
          'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
          [membership.rows[0]!.id, role.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  test('rejects roles that do not match the membership scope', async () => {
    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'role-scope-platform')
      const hospital = await createHospital(
        client,
        organisation,
        'role-scope-platform-hospital',
        'role-scope-platform.example.test',
      )
      const user = await createUser(client, 'subject-role-1', 'role-one@example.test')
      const membership = await client.query<{ id: string }>(
        `insert into control.membership
           (user_id, organisation_id, hospital_id, status, starts_at, accepted_at)
         values ($1, $2, $3, 'active', now(), now())
         returning id`,
        [user, organisation, hospital],
      )
      const role = await client.query<{ id: string }>(
        `select id from control.role
         where organisation_id is null and key = 'platform_admin'`,
      )

      await expect(
        client.query(
          'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
          [membership.rows[0]!.id, role.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })

    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'role-scope-org')
      const hospital = await createHospital(
        client,
        organisation,
        'role-scope-org-hospital',
        'role-scope-org.example.test',
      )
      const user = await createUser(client, 'subject-role-2', 'role-two@example.test')
      const membership = await client.query<{ id: string }>(
        `insert into control.membership
           (user_id, organisation_id, hospital_id, status, starts_at, accepted_at)
         values ($1, $2, $3, 'active', now(), now())
         returning id`,
        [user, organisation, hospital],
      )
      const role = await client.query<{ id: string }>(
        `insert into control.role (organisation_id, key, name, scope)
         values ($1, 'org_role', 'Organisation role', 'organisation')
         returning id`,
        [organisation],
      )

      await expect(
        client.query(
          'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
          [membership.rows[0]!.id, role.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })

    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'role-scope-hospital')
      const user = await createUser(client, 'subject-role-3', 'role-three@example.test')
      const membership = await client.query<{ id: string }>(
        `insert into control.membership
           (user_id, organisation_id, status, starts_at, accepted_at)
         values ($1, $2, 'active', now(), now())
         returning id`,
        [user, organisation],
      )
      const role = await client.query<{ id: string }>(
        `insert into control.role (organisation_id, key, name, scope)
         values ($1, 'hospital_role', 'Hospital role', 'hospital')
         returning id`,
        [organisation],
      )

      await expect(
        client.query(
          'insert into control.membership_role (membership_id, role_id) values ($1, $2)',
          [membership.rows[0]!.id, role.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  test('rejects permissions above the role scope', async () => {
    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'permission-scope-org')
      const role = await client.query<{ id: string }>(
        `insert into control.role (organisation_id, key, name, scope)
         values ($1, 'org_permission_role', 'Organisation permission role', 'organisation')
         returning id`,
        [organisation],
      )

      await expect(
        client.query(
          'insert into control.role_permission (role_id, permission_key) values ($1, $2)',
          [role.rows[0]!.id, 'platform.manage'],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })

    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'permission-scope-hospital')
      const role = await client.query<{ id: string }>(
        `insert into control.role (organisation_id, key, name, scope)
         values ($1, 'hospital_permission_role', 'Hospital permission role', 'hospital')
         returning id`,
        [organisation],
      )

      await expect(
        client.query(
          'insert into control.role_permission (role_id, permission_key) values ($1, $2)',
          [role.rows[0]!.id, 'organisation.manage'],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  test('rejects a hospital that belongs to another organisation', async () => {
    await withTransaction(async (client) => {
      const firstOrg = await createOrganisation(client, 'hospital-org-one')
      const secondOrg = await createOrganisation(client, 'hospital-org-two')
      const hospital = await createHospital(
        client,
        firstOrg,
        'hospital-one',
        'hospital-one.example.test',
      )
      const user = await createUser(client, 'subject-7', 'scope@example.test')

      await expect(
        client.query(
          `insert into control.membership
             (user_id, organisation_id, hospital_id, status, starts_at, accepted_at)
           values ($1, $2, $3, 'active', now(), now())`,
          [user, secondOrg, hospital],
        ),
      ).rejects.toMatchObject({ code: '23503' })
    })
  })

  test('keeps one membership row per user and scope', async () => {
    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'membership-scope')
      const hospital = await createHospital(
        client,
        organisation,
        'membership-hospital',
        'membership.example.test',
      )
      const user = await createUser(client, 'subject-8', 'membership@example.test')

      await client.query(
        `insert into control.membership
           (user_id, organisation_id, hospital_id, status, starts_at, accepted_at)
         values ($1, $2, $3, 'active', now(), now())`,
        [user, organisation, hospital],
      )

      await client.query('savepoint duplicate_invited')
      await expect(
        client.query(
          `insert into control.membership
             (user_id, organisation_id, hospital_id, status)
           values ($1, $2, $3, 'invited')`,
          [user, organisation, hospital],
        ),
      ).rejects.toMatchObject({ code: '23505' })
      await client.query('rollback to savepoint duplicate_invited')

      await client.query('savepoint duplicate_suspended')
      await expect(
        client.query(
          `insert into control.membership
             (user_id, organisation_id, hospital_id, status)
           values ($1, $2, $3, 'suspended')`,
          [user, organisation, hospital],
        ),
      ).rejects.toMatchObject({ code: '23505' })
      await client.query('rollback to savepoint duplicate_suspended')
    })

    await withTransaction(async (client) => {
      const organisation = await createOrganisation(client, 'membership-org')
      const hospital = await createHospital(
        client,
        organisation,
        'membership-org-hospital',
        'membership-org.example.test',
      )
      const user = await createUser(client, 'subject-9', 'org-member@example.test')

      await client.query(
        `insert into control.membership
           (user_id, organisation_id, status, starts_at, accepted_at)
         values ($1, $2, 'active', now(), now())`,
        [user, organisation],
      )
      await client.query(
        `insert into control.membership
           (user_id, organisation_id, hospital_id, status, starts_at, accepted_at)
         values ($1, $2, $3, 'active', now(), now())`,
        [user, organisation, hospital],
      )

      await expect(
        client.query(
          `insert into control.membership
             (user_id, organisation_id, status)
           values ($1, $2, 'invited')`,
          [user, organisation],
        ),
      ).rejects.toMatchObject({ code: '23505' })
    })
  })

  test('seeds the system roles and permissions idempotently', async () => {
    const seed = await Bun.file(
      new URL('../../../migrations/005_seed_system_roles.sql', import.meta.url),
    ).text()
    const up = seed.split('-- Down Migration')[0]
    if (!up) throw new Error('seed migration has no Up section')

    await pool.query(up)
    await pool.query(up)

    const roles = await pool.query<{ key: string }>(
      `select key from control.role
       where organisation_id is null
       order by key`,
    )
    const permissions = await pool.query<{ key: string }>(
      'select key from control.permission order by key',
    )

    expect(roles.rows.map((row) => row.key)).toEqual([
      'auditor',
      'clinician',
      'hospital_admin',
      'org_admin',
      'platform_admin',
    ])
    expect(permissions.rows.map((row) => row.key)).toEqual([
      'audit.read',
      'break_glass.approve',
      'break_glass.request',
      'clinical.read',
      'clinical.write',
      'hospital.manage',
      'membership.manage',
      'organisation.manage',
      'platform.manage',
    ])
  })
})
