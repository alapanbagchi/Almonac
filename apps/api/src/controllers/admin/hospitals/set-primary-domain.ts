import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { withTransaction } from '../../../db/pool'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { recordAdminChange } from '../../../shared/change-log'
import { notFound } from '../../../shared/errors'
import { hospitalResponse } from './responses'

/** Makes a verified domain the hospital's primary address and activates it. */
export async function setPrimaryDomain(
  d: AdminDependencies,
  context: AdminRequestContext,
  hospitalId: string,
  domainId: string,
) {
  const hospitals = createHospitalRepository(d.pool)
  const hospital = await hospitals.findById(hospitalId)
  if (hospital === null) throw notFound('Hospital not found.')
  await d.authorize(context.actor.id, 'hospital.manage', {
    organisationId: hospital.organisationId,
    hospitalId: hospital.id,
  })

  const updated = await withTransaction(d.pool, async (db) => {
    const record = await createHospitalRepository(db).setPrimaryDomain({
      hospitalId: hospital.id,
      domainId,
    })
    if (record === null) throw notFound('Hospital not found.')
    await recordAdminChange(
      d.audit,
      context,
      {
        targetType: 'hospital',
        targetId: record.id,
        organisationId: record.organisationId,
        hospitalId: record.id,
      },
      'hospital.domain_primary_changed',
      db,
    )
    return record
  })
  return hospitalResponse(updated)
}
