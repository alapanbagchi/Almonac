import { withTransaction } from '../../../db/pool'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { createMembershipRepository } from '../../../repositories/membership-repository'
import { createRoleRepository } from '../../../repositories/role-repository'
import { recordAdminChange, type AdminChange } from '../../../shared/change-log'
import type { AdminDependencies } from '../dependencies'
import type { OkResponse } from './responses'
import { assignableRole, preventEscalation, requireMembership } from './rules'

export async function assignRole(
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
  await preventEscalation(d, context, membership, role)

  const change: AdminChange = {
    targetType: 'membership',
    targetId: membership.id,
    organisationId: membership.organisationId,
    hospitalId: membership.hospitalId,
  }

  await withTransaction(d.pool, async (db) => {
    await createRoleRepository(db).assign({
      membershipId,
      roleId,
      assignedBy: context.actor.id,
      at: new Date(),
    })
    await recordAdminChange(d.audit, context, change, 'role.assigned', db, {
      eventType: 'role.assign',
      metadata: { membership_id: membership.id, role_id: role.id },
    })
  })
  return { ok: true }
}
