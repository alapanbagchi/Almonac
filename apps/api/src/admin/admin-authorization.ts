import type { AccessTarget, AuthorizationRepository } from '../access/authorization-repository'
import { forbidden } from './admin-errors'

/**
 * The administration plane is entered either as a platform administrator or as
 * a member holding the permission the caller names. Every admin service asks
 * the same question, so it is answered in one place.
 */
export async function requireAdminPermission(
  authorization: AuthorizationRepository,
  actorId: string,
  permission: string,
  target: AccessTarget,
): Promise<void> {
  const allowed =
    (await authorization.hasPlatformPermission(actorId, 'platform.manage')) ||
    (await authorization.hasPermission(actorId, permission, target))
  if (!allowed) throw forbidden()
}

export async function isPlatformAdmin(
  authorization: AuthorizationRepository,
  actorId: string,
): Promise<boolean> {
  return authorization.hasPlatformPermission(actorId, 'platform.manage')
}
