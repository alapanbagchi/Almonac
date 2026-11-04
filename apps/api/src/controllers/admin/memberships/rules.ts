import type { AdminRequestContext } from '../../../guards/admin-context'
import type { MembershipRepository, MembershipSummary } from '../../../repositories/membership-repository'
import type { OrganisationRole, RoleRepository } from '../../../repositories/role-repository'
import type { Authorize, PlatformAdmin, RolePermissions } from '../../../shared/authorize'
import { conflict, forbidden, notFound, ruleViolation } from '../../../shared/errors'

/** The policy capabilities a rule needs; AdminDependencies satisfies it. */
export interface MembershipPolicy {
  readonly authorize: Authorize
  readonly permissions: RolePermissions
  readonly isPlatformAdmin: PlatformAdmin
}

export interface MembershipStores {
  readonly memberships: MembershipRepository
  readonly roles: RoleRepository
}

/** Load the target, then decide at the scope it actually lives in. */
export async function requireMembership(
  policy: MembershipPolicy,
  stores: MembershipStores,
  context: AdminRequestContext,
  membershipId: string,
): Promise<MembershipSummary> {
  const membership = await stores.memberships.findById(membershipId)
  if (membership === null) throw notFound('Membership not found.')
  await policy.authorize(context.actor.id, 'membership.manage', {
    organisationId: membership.organisationId,
    hospitalId: membership.hospitalId,
  })
  return membership
}

/** An administrator may not lock themselves out. */
export function refuseSelf(
  membership: MembershipSummary,
  actorId: string,
  verb: 'suspend' | 'revoke',
): void {
  if (membership.userId !== actorId) return
  throw conflict(
    verb === 'suspend' ? 'You cannot suspend your own access.' : 'You cannot revoke your own access.',
  )
}

/** An organisation must keep at least one active administrator. */
export async function protectLastOrganisationAdmin(
  stores: MembershipStores,
  membership: MembershipSummary,
): Promise<void> {
  if (membership.hospitalId !== null) return
  const count = await stores.memberships.countActiveOrganisationAdmins(membership.organisationId)
  if (count <= 1) throw conflict('The last organisation administrator cannot be removed.')
}

/** The role must exist in the organisation and match the membership's scope. */
export async function assignableRole(
  stores: MembershipStores,
  membership: MembershipSummary,
  roleId: string,
): Promise<OrganisationRole> {
  const role = await stores.roles.find(membership.organisationId, roleId)
  if (role === null) throw ruleViolation('Role is not available.')
  const expected = membership.hospitalId === null ? 'organisation' : 'hospital'
  if (role.scope !== expected) throw ruleViolation('Role scope does not match the membership.')
  return role
}

/** A non-platform actor may not hand out a permission they do not hold. */
export async function preventEscalation(
  policy: MembershipPolicy,
  context: AdminRequestContext,
  membership: MembershipSummary,
  role: OrganisationRole,
): Promise<void> {
  if (await policy.isPlatformAdmin(context.actor.id)) return
  const held = new Set(
    await policy.permissions(context.actor.id, {
      organisationId: membership.organisationId,
      hospitalId: membership.hospitalId,
    }),
  )
  if (role.permissions.some((permission) => !held.has(permission))) throw forbidden()
}
