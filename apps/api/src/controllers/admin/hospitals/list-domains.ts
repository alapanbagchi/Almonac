import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import type { PageRequest } from '../../../shared/pagination'
import { pageResponse } from '../../../shared/pagination'
import { notFound } from '../../../shared/errors'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { domainResponse } from './responses'

/** Domains of one hospital; the hospital is loaded before it is authorised. */
export async function listDomains(
  d: AdminDependencies,
  context: AdminRequestContext,
  hospitalId: string,
  page: PageRequest,
) {
  const hospitals = createHospitalRepository(d.pool)
  const hospital = await hospitals.findById(hospitalId)
  if (hospital === null) throw notFound('Hospital not found.')
  await d.authorize(context.actor.id, 'hospital.manage', {
    organisationId: hospital.organisationId,
    hospitalId: hospital.id,
  })
  return pageResponse(await hospitals.listDomains(hospital.id, page), domainResponse)
}
