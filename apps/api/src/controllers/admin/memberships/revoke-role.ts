import { withTransaction } from '../../../db/pool'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { createMembershipRepository } from '../../../repositories/membership-repository'
import { createRoleRepository } from '../../../repositories/role-repository'
import { recordAdminChange, type AdminChange } from '../../../shared/change-log'
import { conflict } from '../../../shared/errors'
import type { AdminDependencies } from '../dependencies'
import type { OkResponse } from './responses'
import { assignableRole, protectLastOrganisationAdmin, requireMembership } from './rules'

export async function revokeRole(
  d: AdminDependencies,
  context: AdminRequestContext,
  membershipId: string,
  roleId: string,
): Promise<OkResponse> {
  const stores = {
    memberships: createMembershipRepository(d.pool),
    roles: createRoleRepository(d.pool),
  }
  const membership = await requireMembership(d, stores, context, membershipId)
  const role = await assignableRole(stores, membership, roleId)
  // Removing the managing role can empty the organisation's administrator set.
  if (role.permissions.includes('organisation.manage') && membership.hospitalId === null) {
    await protectLastOrganisationAdmin(stores, membership)
  }

  const change: AdminChange = {
    targetType: 'membership',
    targetId: membership.id,
    organisationId: membership.organisationId,
    hospitalId: membership.hospitalId,
  }

  await withTransaction(d.pool, async (db) => {
    const revoked = await createRoleRepository(db).revoke({
      membershipId,
      roleId,
      revokedBy: context.actor.id,
      at: new Date(),
      reason: 'role revoked by administrator',
    })
    if (!revoked) throw conflict('Role assignment is not active.')
    await recordAdminChange(d.audit, context, change, 'role.revoked', db, {
      eventType: 'role.assign',
      metadata: { membership_id: membership.id, role_id: role.id },
    })
  })
  return { ok: true }
}
