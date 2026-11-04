import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { withTransaction } from '../../../db/pool'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { recordAdminChange } from '../../../shared/change-log'
import { notFound } from '../../../shared/errors'
import { mintToken } from '../../../shared/tokens'
import { domainResponse } from './responses'

/** Registers a domain, returning its one-time verification token. */
export async function addDomain(
  d: AdminDependencies,
  context: AdminRequestContext,
  hospitalId: string,
  domain: string,
) {
  const hospitals = createHospitalRepository(d.pool)
  const hospital = await hospitals.findById(hospitalId)
  if (hospital === null) throw notFound('Hospital not found.')
  await d.authorize(context.actor.id, 'hospital.manage', {
    organisationId: hospital.organisationId,
    hospitalId: hospital.id,
  })

  const minted = mintToken()
  const created = await withTransaction(d.pool, async (db) => {
    const record = await createHospitalRepository(db).addDomain({
      hospitalId: hospital.id,
      domain,
      tokenHash: minted.tokenHash,
    })
    await recordAdminChange(
      d.audit,
      context,
      {
        targetType: 'hospital_domain',
        targetId: record.id,
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
      },
      'hospital.domain_added',
      db,
    )
    return record
  })
  return { domain: domainResponse(created), token: minted.token }
}
