import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import type { PageRequest } from '../../../shared/pagination'
import { pageResponse } from '../../../shared/pagination'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { hospitalResponse } from './responses'

/** One page of an organisation's hospitals, authorised at the organisation. */
export async function listHospitals(
  d: AdminDependencies,
  context: AdminRequestContext,
  organisationId: string,
  page: PageRequest,
) {
  await d.authorize(context.actor.id, 'hospital.manage', { organisationId })
  const hospitals = await createHospitalRepository(d.pool).listByOrganisation(
    organisationId,
    page,
  )
  return pageResponse(hospitals, hospitalResponse)
}
