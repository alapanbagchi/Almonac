import type { DatabaseQuery } from '../db/pool'
import { rowRecord } from '../db/rows'
import type { AccessTarget } from '../shared/access-target'

export interface AuthorizationGateway {
  hasPlatformPermission(userId: string, permission: string): Promise<boolean>
  /** True when any one of several platform permissions is held. */
  hasAnyPlatformPermission(userId: string, permissions: readonly string[]): Promise<boolean>
  hasPermission(userId: string, permission: string, target: AccessTarget, at?: Date): Promise<boolean>
  listPermissions(userId: string, target: AccessTarget, at?: Date): Promise<string[]>
}

/**
 * Authorisation is resolved from the database on every request. The session
 * response is informational and must never be the source of a decision.
 */
export function createAuthorizationRepository(db: DatabaseQuery): AuthorizationGateway {
  return {
    hasPlatformPermission(userId, permission) {
      return hasAnyPlatformPermission(db, userId, [permission])
    },

    hasAnyPlatformPermission(userId, permissions) {
      return hasAnyPlatformPermission(db, userId, permissions)
    },

    async hasPermission(userId, permission, target, at = new Date()) {
      if (await hasAnyPlatformPermission(db, userId, [permission])) return true

      const result = await db.query(
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
      return isAllowed(result.rows[0])
    },

    async listPermissions(userId, target, at = new Date()) {
      const result = await db.query(
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
      return result.rows.map((row) => {
        const key = rowRecord(row).permission_key
        if (typeof key !== 'string') throw new Error('database field permission_key is not text')
        return key
      })
    },
  }
}

async function hasAnyPlatformPermission(
  db: DatabaseQuery,
  userId: string,
  permissions: readonly string[],
): Promise<boolean> {
  const result = await db.query(
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
  return isAllowed(result.rows[0])
}

function isAllowed(value: unknown): boolean {
  return value !== undefined && rowRecord(value).allowed === true
}
