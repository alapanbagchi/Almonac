import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { withTransaction } from '../../../db/pool'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { recordAdminChange } from '../../../shared/change-log'
import { hospitalResponse } from './responses'

export interface CreateHospitalInput {
  readonly name: string
  readonly slug: string
  readonly timezone?: string
}

/** Creates a hospital and its audit event in one transaction. */
export async function createHospital(
  d: AdminDependencies,
  context: AdminRequestContext,
  organisationId: string,
  input: CreateHospitalInput,
) {
  await d.authorize(context.actor.id, 'hospital.manage', { organisationId })
  const hospital = await withTransaction(d.pool, async (db) => {
    const created = await createHospitalRepository(db).create({
      organisationId,
      name: input.name,
      slug: input.slug,
      timezone: input.timezone ?? 'UTC',
    })
    await recordAdminChange(
      d.audit,
      context,
      {
        targetType: 'hospital',
        targetId: created.id,
        organisationId,
        hospitalId: created.id,
      },
      'hospital.created',
      db,
    )
    return created
  })
  return hospitalResponse(hospital)
}
