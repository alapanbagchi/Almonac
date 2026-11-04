import type { AdminRequestContext } from '../../../guards/admin-context'
import { createMembershipRepository } from '../../../repositories/membership-repository'
import { createRoleRepository } from '../../../repositories/role-repository'
import { recordAdminChange, type AdminChange } from '../../../shared/change-log'
import { conflict } from '../../../shared/errors'
import type { AdminDependencies } from '../dependencies'
import type { OkResponse } from './responses'
import { refuseSelf, requireMembership } from './rules'

export async function suspendMembership(
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
  refuseSelf(membership, context.actor.id, 'suspend')

  const change: AdminChange = {
    targetType: 'membership',
    targetId: membership.id,
    organisationId: membership.organisationId,
    hospitalId: membership.hospitalId,
  }

  await d.transaction(async (db) => {
    const suspended = await createMembershipRepository(db).suspend(membership.id, new Date())
    if (!suspended) throw conflict('Membership is not active.')
    await recordAdminChange(d.audit, context, change, 'membership.suspended', db, {
      eventType: 'membership.change',
      reason,
      metadata: {
        membership_id: membership.id,
        from_status: 'active',
        to_status: 'suspended',
      },
    })
  })
  return { ok: true }
}
