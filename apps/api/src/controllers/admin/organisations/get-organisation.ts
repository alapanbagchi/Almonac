import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { notFound } from '../../../shared/errors'
import { createOrganisationRepository } from '../../../repositories/organisation-repository'
import { organisationResponse } from './responses'

export async function getOrganisation(
  d: AdminDependencies,
  context: AdminRequestContext,
  organisationId: string,
) {
  await d.authorize(context.actor.id, 'organisation.manage', { organisationId })
  const organisation = await createOrganisationRepository(d.db).findById(organisationId)
  if (organisation === null) throw notFound('Organisation not found.')
  return organisationResponse(organisation)
}
