import type { DatabaseQuery } from '../db/pool'
import { rowRecord, stringField } from '../db/rows'

export interface AccessTarget {
  readonly organisationId: string
  readonly hospitalId?: string | null
}

/**
 * Authorisation is resolved from the database on every request. The session
 * response is informational and must never be the source of a decision.
 */
export class AuthorizationRepository {
  constructor(private readonly db: DatabaseQuery) {}

  async hasPlatformPermission(userId: string, permission: string): Promise<boolean> {
    return this.hasAnyPlatformPermission(userId, [permission])
  }

  /** True when any one of several platform permissions is held. */
  async hasAnyPlatformPermission(userId: string, permissions: readonly string[]): Promise<boolean> {
    const result = await this.db.query(
      `select exists (
         select 1
         from control.platform_assignment as assignment
         join control.role as role on role.id = assignment.role_id
         join control.role_permission as role_permission
           on role_permission.role_id = role.id
         join control.permission as permission
           on permission.key = role_permission.permission_key
         where assignment.user_id = $1
           and role_permission.permission_key = any($2::text[])
           and role.scope = 'platform'
           and not permission.is_clinical
       ) as allowed`,
      [userId, permissions],
    )
    return result.rows[0] !== undefined && isAllowed(result.rows[0])
  }

  async hasPermission(
    userId: string,
    permission: string,
    target: AccessTarget,
    at: Date = new Date(),
  ): Promise<boolean> {
    if (await this.hasPlatformPermission(userId, permission)) return true

    const result = await this.db.query(
      `select exists (
         select 1
         from control.membership as membership
         join control.membership_role as membership_role
           on membership_role.membership_id = membership.id
          and membership_role.revoked_at is null
          and membership_role.validity @> $4::timestamptz
         join control.role_permission as role_permission
           on role_permission.role_id = membership_role.role_id
         join control.permission as permission
           on permission.key = role_permission.permission_key
         where membership.user_id = $1
           and membership.status = 'active'
           and membership.validity @> $4::timestamptz
           and role_permission.permission_key = $2
           and (
             membership.organisation_id = $3
             and (
               membership.hospital_id is not null
               or not permission.is_clinical
             )
             and (
               membership.hospital_id is null
               or membership.hospital_id = $5
             )
           )
       ) as allowed`,
      [userId, permission, target.organisationId, at, target.hospitalId ?? null],
    )
    return result.rows[0] !== undefined && isAllowed(result.rows[0])
  }

  async listPermissions(
    userId: string,
    target: AccessTarget,
    at: Date = new Date(),
  ): Promise<string[]> {
    const result = await this.db.query(
      `select distinct permission_key
         from (
           select role_permission.permission_key
             from control.platform_assignment as assignment
             join control.role_permission as role_permission
               on role_permission.role_id = assignment.role_id
             join control.permission as permission
               on permission.key = role_permission.permission_key
            where assignment.user_id = $1
              and not permission.is_clinical
           union
           select role_permission.permission_key
             from control.membership as membership
             join control.membership_role as membership_role
               on membership_role.membership_id = membership.id
              and membership_role.revoked_at is null
              and membership_role.validity @> $4::timestamptz
             join control.role_permission as role_permission
               on role_permission.role_id = membership_role.role_id
             join control.permission as permission
               on permission.key = role_permission.permission_key
            where membership.user_id = $1
              and membership.status = 'active'
              and membership.validity @> $4::timestamptz
              and membership.organisation_id = $2
              and (
                membership.hospital_id is not null
                or not permission.is_clinical
              )
              and (
                membership.hospital_id is null
                or membership.hospital_id = $3
              )
         ) as permissions
        order by permission_key`,
      [userId, target.organisationId, target.hospitalId ?? null, at],
    )
    return result.rows.map((row) => stringField(rowRecord(row), 'permission_key'))
  }
}

function isAllowed(value: unknown): boolean {
  return rowRecord(value).allowed === true
}