import { withTransaction } from '../../db/pool'
import { conflict, forbidden, notFound } from '../../shared/errors'
import { createBreakGlassRepository } from '../../repositories/break-glass-repository'
import { grantResponse, type GrantResponse } from './responses'
import {
  changeMetadata,
  isApprover,
  nowOf,
  normaliseReason,
  writeGrantAudit,
  type BreakGlassContext,
  type BreakGlassDependencies,
} from './support'

/** The holder or an approver can close a grant early; the reason is audited. */
export async function revokeGrant(
  dependencies: Pick<
    BreakGlassDependencies,
    'pool' | 'audit' | 'hasAnyPlatformPermission' | 'clock'
  >,
  context: BreakGlassContext,
  grantId: string,
  reason: string,
): Promise<GrantResponse> {
  const now = nowOf(dependencies)
  const grant = await createBreakGlassRepository(dependencies.pool).findById(grantId)
  if (grant === null) throw notFound('Break-glass grant not found.')
  if (grant.userId !== context.actor.id && !(await isApprover(dependencies, context.actor.id))) {
    throw forbidden()
  }
  const revokeReason = normaliseReason(reason)

  return withTransaction(dependencies.pool, async (db) => {
    const revoked = await createBreakGlassRepository(db).revoke(grant.id, now)
    if (revoked === null) throw conflict('The grant is already closed.')
    await writeGrantAudit(dependencies.audit, context, db, revoked, {
      eventType: 'admin.change',
      reason: revokeReason,
      reasonCode: 'break_glass.revoked',
      metadata: changeMetadata(revoked.id),
    })
    return grantResponse(revoked)
  })
}
