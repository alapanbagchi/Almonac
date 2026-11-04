import { forbidden } from './errors'
import type { AccessTarget } from './access-target'

export type { AccessTarget }

/** Throws unless the actor may act on this organisation/hospital. */
export type Authorize = (actorId: string, permission: string, target: AccessTarget) => Promise<void>

/** Permissions the actor actually holds at a target, for the escalation check. */
export type RolePermissions = (actorId: string, target: AccessTarget) => Promise<string[]>

export type PlatformAdmin = (actorId: string) => Promise<boolean>

/** What authorisation needs from the database, and nothing more. */
export interface AuthorizationGateway {
  hasPlatformPermission(userId: string, permission: string): Promise<boolean>
  hasPermission(
    userId: string,
    permission: string,
    target: AccessTarget,
    at?: Date,
  ): Promise<boolean>
  listPermissions(userId: string, target: AccessTarget, at?: Date): Promise<string[]>
}

/**
 * One authorisation rule for the whole API: a platform administrator may act
 * anywhere, everyone else needs the named permission at the named scope.
 * Because it is a function, a denial test is three lines and no database.
 */
export function createAuthorize(gateway: AuthorizationGateway): Authorize {
  return async (actorId, permission, target) => {
    if (await gateway.hasPlatformPermission(actorId, 'platform.manage')) return
    if (await gateway.hasPermission(actorId, permission, target)) return
    throw forbidden()
  }
}

export function createIsPlatformAdmin(gateway: AuthorizationGateway): PlatformAdmin {
  return (actorId) => gateway.hasPlatformPermission(actorId, 'platform.manage')
}

export function createRolePermissions(gateway: AuthorizationGateway): RolePermissions {
  return (actorId, target) => gateway.listPermissions(actorId, target)
}
