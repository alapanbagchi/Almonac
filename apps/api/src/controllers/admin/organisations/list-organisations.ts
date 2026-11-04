import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { pageOf, pageRequest, pageResponse } from '../../../shared/pagination'
import { createOrganisationRepository } from '../../../repositories/organisation-repository'
import { organisationResponse } from './responses'

/** Platform administrators see every organisation; everyone else their own. */
export async function listOrganisations(
  d: AdminDependencies,
  context: AdminRequestContext,
  query: { readonly limit?: string; readonly offset?: string },
) {
  const request = pageRequest(query)
  const organisations = createOrganisationRepository(d.pool)
  const rows = (await d.isPlatformAdmin(context.actor.id))
    ? await organisations.listAll(request)
    : await organisations.listForUser(context.actor.id, request)
  return pageResponse(pageOf(rows, request), organisationResponse)
}
