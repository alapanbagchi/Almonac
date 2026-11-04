import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
  textArrayField,
} from '../db/rows'

export interface MembershipAccess {
  readonly id: string
  readonly organisationId: string
  readonly organisationName: string
  readonly hospitalId: string | null
  readonly hospitalName: string | null
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly roles: readonly string[]
}

export interface SessionAccess {
  readonly memberships: readonly MembershipAccess[]
  readonly permissions: readonly string[]
}

export interface AccessRepository {
  listForUser(userId: string, at: Date): Promise<SessionAccess>
}

const MEMBERSHIP_QUERY = `
  select
    membership.id,
    membership.organisation_id,
    organisation.name as organisation_name,
    membership.hospital_id,
    hospital.name as hospital_name,
    lower(membership.validity) as starts_at,
    upper(membership.validity) as ends_at,
    coalesce(
      array_agg(distinct role.key order by role.key)
        filter (where role.key is not null),
      '{}'::text[]
    ) as roles
  from control.membership as membership
  join control.organisation as organisation
    on organisation.id = membership.organisation_id
  left join control.hospital as hospital
    on hospital.id = membership.hospital_id
  left join control.membership_role as membership_role
    on membership_role.membership_id = membership.id
   and membership_role.revoked_at is null
   and membership_role.validity @> $2::timestamptz
  left join control.role as role
    on role.id = membership_role.role_id
  where membership.user_id = $1
    and membership.status = 'active'
    and membership.validity @> $2::timestamptz
  group by
    membership.id, membership.organisation_id, organisation.name,
    membership.hospital_id, hospital.name, membership.validity
  order by organisation.name, hospital.name nulls first, membership.id
`

const PERMISSION_QUERY = `
  select distinct permission_key
  from (
    select role_permission.permission_key
    from control.membership as membership
    join control.membership_role as membership_role
      on membership_role.membership_id = membership.id
     and membership_role.revoked_at is null
     and membership_role.validity @> $2::timestamptz
    join control.role_permission as role_permission
      on role_permission.role_id = membership_role.role_id
    where membership.user_id = $1
      and membership.status = 'active'
      and membership.validity @> $2::timestamptz
    union
    select role_permission.permission_key
    from control.platform_assignment as assignment
    join control.role_permission as role_permission
      on role_permission.role_id = assignment.role_id
    where assignment.user_id = $1
  ) as permissions
  order by permission_key
`

/**
 * Read the memberships and permissions that a session response shows.
 *
 * This is informational, never the authorisation decision for a protected
 * route: a membership can change between the two queries.
 */
export function createAccessRepository(db: DatabaseQuery): AccessRepository {
  return {
    async listForUser(userId, at) {
      const memberships = await db.query(MEMBERSHIP_QUERY, [userId, at])
      const permissions = await db.query(PERMISSION_QUERY, [userId, at])

      return {
        memberships: memberships.rows.map(mapMembership),
        permissions: permissions.rows.map((row) =>
          stringField(rowRecord(row), 'permission_key'),
        ),
      }
    },
  }
}

function mapMembership(value: unknown): MembershipAccess {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    organisationId: stringField(row, 'organisation_id'),
    organisationName: stringField(row, 'organisation_name'),
    hospitalId: nullableStringField(row, 'hospital_id'),
    hospitalName: nullableStringField(row, 'hospital_name'),
    startsAt: dateField(row, 'starts_at'),
    endsAt: nullableDateField(row, 'ends_at'),
    roles: textArrayField(row, 'roles'),
  }
}
