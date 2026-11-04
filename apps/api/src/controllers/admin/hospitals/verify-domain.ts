import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { recordAdminChange } from '../../../shared/change-log'
import { notFound, ruleViolation } from '../../../shared/errors'
import { hashToken } from '../../../shared/tokens'
import { domainResponse } from './responses'

/** Consumes the verification token; a stale or wrong token is a rule violation. */
export async function verifyDomain(
  d: AdminDependencies,
  context: AdminRequestContext,
  hospitalId: string,
  domainId: string,
  token: string,
) {
  const hospitals = createHospitalRepository(d.db)
  const hospital = await hospitals.findById(hospitalId)
  if (hospital === null) throw notFound('Hospital not found.')
  await d.authorize(context.actor.id, 'hospital.manage', {
    organisationId: hospital.organisationId,
    hospitalId: hospital.id,
  })

  const verified = await d.transaction(async (db) => {
    const domain = await createHospitalRepository(db).verifyDomain({
      hospitalId: hospital.id,
      domainId,
      tokenHash: hashToken(token),
      at: new Date(),
    })
    if (domain === null) throw ruleViolation('Domain verification failed.')
    await recordAdminChange(
      d.audit,
      context,
      {
        targetType: 'hospital_domain',
        targetId: domain.id,
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
      },
      'hospital.domain_verified',
      db,
    )
    return domain
  })
  return domainResponse(verified)
}
