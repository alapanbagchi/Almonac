import type { AdminRequestContext } from '../../../guards/admin-context'
import { createMembershipRepository } from '../../../repositories/membership-repository'
import { createRoleRepository } from '../../../repositories/role-repository'
import { recordAdminChange, type AdminChange } from '../../../shared/change-log'
import { conflict } from '../../../shared/errors'
import type { AdminDependencies } from '../dependencies'
import type { OkResponse } from './responses'
import { protectLastOrganisationAdmin, refuseSelf, requireMembership } from './rules'

export async function revokeMembership(
  d: AdminDependencies,
  context: AdminRequestContext,
  membershipId: string,
  reason: string,
): Promise<OkResponse> {
  const stores = {
    memberships: createMembershipRepository(d.db),
    roles: createRoleRepository(d.db),
  }
  const membership = await requireMembership(d, stores, context, membershipId)
  refuseSelf(membership, context.actor.id, 'revoke')
  await protectLastOrganisationAdmin(stores, membership)

  const change: AdminChange = {
    targetType: 'membership',
    targetId: membership.id,
    organisationId: membership.organisationId,
    hospitalId: membership.hospitalId,
  }

  await d.transaction(async (db) => {
    const revoked = await createMembershipRepository(db).revoke({
      id: membership.id,
      at: new Date(),
      revokedBy: context.actor.id,
      reason,
    })
    if (!revoked) throw conflict('Membership cannot be revoked.')
    await recordAdminChange(d.audit, context, change, 'membership.revoked', db, {
      eventType: 'membership.change',
      reason,
      metadata: {
        membership_id: membership.id,
        from_status: membership.status,
        to_status: 'revoked',
      },
    })
  })
  return { ok: true }
}
