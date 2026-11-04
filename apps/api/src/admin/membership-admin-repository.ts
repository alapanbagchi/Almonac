import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
  textArrayField,
} from '../db/rows'

export type MembershipStatus = 'active' | 'suspended' | 'revoked' | 'expired'

export interface MembershipSummary {
  readonly id: string
  readonly userId: string
  readonly email: string
  readonly displayName: string
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly status: MembershipStatus
  readonly acceptedAt: Date
  readonly endsAt: Date | null
  readonly roles: readonly string[]
}

export interface OrganisationRole {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly scope: 'organisation' | 'hospital'
  readonly permissions: readonly string[]
}

export class RoleAssignmentConflictError extends Error {
  constructor() {
    super('role is already assigned to this membership')
    this.name = 'RoleAssignmentConflictError'
  }
}

export class MembershipConflictError extends Error {
  constructor() {
    super('a membership already exists for this scope')
    this.name = 'MembershipConflictError'
  }
}

const MEMBERSHIP_SELECT = `
  select
    membership.id,
    membership.user_id,
    app_user.email::text as email,
    app_user.display_name,
    membership.organisation_id,
    membership.hospital_id,
    membership.status,
    membership.accepted_at,
    upper(membership.validity) as ends_at,
    coalesce(
      array_agg(distinct role.key order by role.key)
        filter (where role.key is not null),
      '{}'::text[]
    ) as roles
  from control.membership as membership
  join identity.app_user as app_user on app_user.id = membership.user_id
  left join control.membership_role as membership_role
    on membership_role.membership_id = membership.id
   and membership_role.revoked_at is null
   and membership_role.validity @> now()
  left join control.role as role on role.id = membership_role.role_id
`

const ROLE_SELECT = `
  select role.id, role.key, role.name, role.scope,
         coalesce(
           array_agg(role_permission.permission_key order by role_permission.permission_key)
             filter (where role_permission.permission_key is not null),
           '{}'::text[]
         ) as permissions
    from control.role as role
    left join control.role_permission as role_permission
      on role_permission.role_id = role.id
`

export class MembershipAdminRepository {
  constructor(private readonly db: DatabaseQuery) {}

  async createFromInvitation(
    input: {
      userId: string
      organisationId: string
      hospitalId: string | null
      roleIds: readonly string[]
      assignedBy: string
    },
    /** Pass the caller's transaction so the new rows join its snapshot. */
    db: DatabaseQuery = this.db,
  ): Promise<string> {
    try {
      const result = await db.query(
        `insert into control.membership
           (user_id, organisation_id, hospital_id, accepted_at, validity)
         values ($1, $2, $3, now(), tstzrange(now(), null, '[)'))
         returning id`,
        [input.userId, input.organisationId, input.hospitalId],
      )
      const membershipId = stringField(rowRecord(result.rows[0]), 'id')
      for (const roleId of input.roleIds) {
        await db.query(
          `insert into control.membership_role
             (membership_id, role_id, assigned_by, assigned_at, validity)
           values ($1, $2, $3, now(), tstzrange(now(), null, '[)'))`,
          [membershipId, roleId, input.assignedBy],
        )
      }
      return membershipId
    } catch (error) {
      if (isExclusionViolation(error)) throw new MembershipConflictError()
      throw error
    }
  }

  async findById(id: string): Promise<MembershipSummary | null> {
    const result = await this.db.query(
      `${MEMBERSHIP_SELECT}
       where membership.id = $1
       group by membership.id, app_user.email, app_user.display_name`,
      [id],
    )
    return result.rows[0] === undefined ? null : mapMembership(result.rows[0])
  }

  async list(input: {
    organisationId: string
    hospitalId?: string | null
  }): Promise<MembershipSummary[]> {
    const result = await this.db.query(
      `${MEMBERSHIP_SELECT}
       where membership.organisation_id = $1
         and ($2::uuid is null or membership.hospital_id = $2)
       group by membership.id, app_user.email, app_user.display_name
       order by app_user.display_name, app_user.email, membership.id`,
      [input.organisationId, input.hospitalId ?? null],
    )
    return result.rows.map(mapMembership)
  }

  async listRoles(organisationId: string): Promise<OrganisationRole[]> {
    const result = await this.db.query(
      `${ROLE_SELECT}
        where role.organisation_id = $1
        group by role.id, role.key, role.name, role.scope
        order by role.scope, role.key`,
      [organisationId],
    )
    return result.rows.map(mapRole)
  }

  async findRole(organisationId: string, roleId: string): Promise<OrganisationRole | null> {
    const result = await this.db.query(
      `${ROLE_SELECT}
        where role.organisation_id = $1 and role.id = $2
        group by role.id, role.key, role.name, role.scope`,
      [organisationId, roleId],
    )
    return result.rows[0] === undefined ? null : mapRole(result.rows[0])
  }

  async assignRole(input: {
    membershipId: string
    roleId: string
    assignedBy: string
    at: Date
  }): Promise<void> {
    try {
      await this.db.query(
        `insert into control.membership_role
           (membership_id, role_id, assigned_by, assigned_at, validity)
         values ($1, $2, $3, $4, tstzrange($4, null, '[)'))`,
        [input.membershipId, input.roleId, input.assignedBy, input.at],
      )
    } catch (error) {
      if (isExclusionViolation(error)) throw new RoleAssignmentConflictError()
      throw error
    }
  }

  async revokeRole(input: {
    membershipId: string
    roleId: string
    revokedBy: string
    at: Date
    reason: string
  }): Promise<boolean> {
    const result = await this.db.query(
      `update control.membership_role
          set revoked_at = $3, revoked_by = $4, revoke_reason = $5,
              validity = tstzrange(lower(validity), $3, '[)')
        where membership_id = $1
          and role_id = $2
          and revoked_at is null
          and validity @> $3::timestamptz
        returning id`,
      [input.membershipId, input.roleId, input.at, input.revokedBy, input.reason],
    )
    return result.rows.length > 0
  }

  async suspend(id: string, at: Date): Promise<boolean> {
    const result = await this.db.query(
      `update control.membership
          set status = 'suspended', suspended_at = $2
        where id = $1 and status = 'active'
        returning id`,
      [id, at],
    )
    return result.rows.length > 0
  }

  async revoke(input: {
    id: string
    at: Date
    revokedBy: string
    reason: string
  }): Promise<boolean> {
    const result = await this.db.query(
      `update control.membership
          set status = 'revoked', revoked_at = $2, revoked_by = $3,
              revoke_reason = $4, validity = tstzrange(lower(validity), $2, '[)')
        where id = $1 and status in ('active', 'suspended')
        returning id`,
      [input.id, input.at, input.revokedBy, input.reason],
    )
    return result.rows.length > 0
  }

  async countActiveOrganisationAdmins(organisationId: string): Promise<number> {
    const result = await this.db.query(
      `select count(distinct membership.id)::int as count
         from control.membership as membership
         join control.membership_role as membership_role
           on membership_role.membership_id = membership.id
          and membership_role.revoked_at is null
          and membership_role.validity @> now()
         join control.role_permission as role_permission
           on role_permission.role_id = membership_role.role_id
        where membership.organisation_id = $1
          and membership.hospital_id is null
          and membership.status = 'active'
          and membership.validity @> now()
          and role_permission.permission_key = 'organisation.manage'`,
      [organisationId],
    )
    const value = rowRecord(result.rows[0] ?? {})
    return typeof value.count === 'number' ? value.count : 0
  }

  async findActiveMembershipForUser(input: {
    userId: string
    organisationId: string
    hospitalId?: string | null
  }): Promise<MembershipSummary | null> {
    const result = await this.db.query(
      `${MEMBERSHIP_SELECT}
       where membership.user_id = $1
         and membership.organisation_id = $2
         and ($3::uuid is null or membership.hospital_id = $3)
         and membership.status = 'active'
         and membership.validity @> now()
       group by membership.id, app_user.email, app_user.display_name
       limit 1`,
      [input.userId, input.organisationId, input.hospitalId ?? null],
    )
    return result.rows[0] === undefined ? null : mapMembership(result.rows[0])
  }
}

function mapRole(value: unknown): OrganisationRole {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    key: stringField(row, 'key'),
    name: stringField(row, 'name'),
    scope: stringField(row, 'scope') as 'organisation' | 'hospital',
    permissions: textArrayField(row, 'permissions'),
  }
}

function mapMembership(value: unknown): MembershipSummary {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    userId: stringField(row, 'user_id'),
    email: stringField(row, 'email'),
    displayName: stringField(row, 'display_name'),
    organisationId: stringField(row, 'organisation_id'),
    hospitalId: nullableStringField(row, 'hospital_id'),
    status: stringField(row, 'status') as MembershipStatus,
    acceptedAt: dateField(row, 'accepted_at'),
    endsAt: nullableDateField(row, 'ends_at'),
    roles: textArrayField(row, 'roles'),
  }
}

function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23P01'
  )
}
