import type { AdminRequestContext } from '../../../guards/admin-context'
import { createRoleRepository } from '../../../repositories/role-repository'
import { pageResponse, type Page, type PageRequest } from '../../../shared/pagination'
import type { AdminDependencies } from '../dependencies'
import { roleResponse, type RoleResponse } from './responses'

/** The catalogue an organisation administrator can assign. */
export async function listRoles(
  d: AdminDependencies,
  context: AdminRequestContext,
  organisationId: string,
  page: PageRequest,
): Promise<Page<RoleResponse>> {
  await d.authorize(context.actor.id, 'membership.manage', { organisationId, hospitalId: null })
  const roles = createRoleRepository(d.pool)
  const found = await roles.list(organisationId, page)
  return pageResponse(found, roleResponse)
}
