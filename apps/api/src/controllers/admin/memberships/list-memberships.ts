import type { AdminRequestContext } from '../../../guards/admin-context'
import { createMembershipRepository } from '../../../repositories/membership-repository'
import { pageResponse, type Page, type PageRequest } from '../../../shared/pagination'
import type { AdminDependencies } from '../dependencies'
import { membershipResponse, type MembershipResponse } from './responses'

/** Members of one organisation, optionally narrowed to one hospital. */
export async function listMemberships(
  d: AdminDependencies,
  context: AdminRequestContext,
  organisationId: string,
  hospitalId: string | null,
  page: PageRequest,
): Promise<Page<MembershipResponse>> {
  await d.authorize(context.actor.id, 'membership.manage', { organisationId, hospitalId })
  const memberships = createMembershipRepository(d.db)
  const found = await memberships.list({ organisationId, hospitalId }, page)
  return pageResponse(found, membershipResponse)
}
