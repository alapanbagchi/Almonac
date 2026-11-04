import { requireAssurance } from '../../auth/assurance'
import { withTransaction } from '../../db/pool'
import { conflict, forbidden, notFound } from '../../shared/errors'
import { createBreakGlassRepository } from '../../repositories/break-glass-repository'
import { grantResponse, type GrantResponse } from './responses'
import {
  BREAK_GLASS_ASSURANCE,
  nowOf,
  requireActiveMembership,
  writeGrantAudit,
  type BreakGlassContext,
  type BreakGlassDependencies,
} from './support'

/** The pre-approved person turns their own grant live while it still fits. */
export async function activateGrant(
  dependencies: Pick<BreakGlassDependencies, 'pool' | 'audit' | 'clock'>,
  context: BreakGlassContext,
  grantId: string,
): Promise<GrantResponse> {
  const now = nowOf(dependencies)
  const grants = createBreakGlassRepository(dependencies.pool)
  const grant = await grants.findById(grantId)
  if (grant === null) throw notFound('Break-glass grant not found.')
  if (grant.userId !== context.actor.id) throw forbidden()
  if (grant.status !== 'approved') throw conflict('The grant is not awaiting activation.')
  if (grant.endsAt <= now) throw conflict('The grant has expired.')
  requireAssurance(context, BREAK_GLASS_ASSURANCE, now)
  await requireActiveMembership(
    grants,
    context.actor.id,
    { id: grant.hospitalId, organisationId: grant.organisationId },
    now,
  )

  return withTransaction(dependencies.pool, async (db) => {
    const activated = await createBreakGlassRepository(db).activate(
      grant.id,
      context.actor.id,
      now,
    )
    if (activated === null) throw conflict('The grant can no longer be activated.')
    await writeGrantAudit(dependencies.audit, context, db, activated, {
      eventType: 'break_glass.activate',
      reasonCode: 'break_glass.activated',
    })
    return grantResponse(activated)
  })
}
