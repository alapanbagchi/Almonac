import { conflict, forbidden, notFound, ruleViolation } from '../../shared/errors'
import { createBreakGlassRepository, type BreakGlassDecision } from '../../repositories/break-glass-repository'
import { reviewResponse, type ReviewResponse } from './responses'
import {
  nowOf,
  requireApprover,
  writeGrantAudit,
  type BreakGlassContext,
  type BreakGlassDependencies,
} from './support'

/** Only an uninvolved approver reviews a grant, and only after its window. */
export async function reviewGrant(
  dependencies: Pick<
    BreakGlassDependencies,
    'db' | 'transaction' | 'audit' | 'hasAnyPlatformPermission' | 'clock'
  >,
  context: BreakGlassContext,
  grantId: string,
  decision: BreakGlassDecision,
  notes: string | null,
): Promise<ReviewResponse> {
  const now = nowOf(dependencies)
  await requireApprover(dependencies, context.actor.id)
  const grant = await createBreakGlassRepository(dependencies.db).findById(grantId)
  if (grant === null) throw notFound('Break-glass grant not found.')
  if (grant.userId === context.actor.id || grant.approvedBy === context.actor.id) {
    throw forbidden()
  }
  if (grant.endsAt > now) throw conflict('Access must end before it is reviewed.')
  const reviewNotes = notes?.trim() || null
  if (reviewNotes !== null && reviewNotes.length > 1_000) {
    throw ruleViolation('Review notes are too long.')
  }

  return dependencies.transaction( async (db) => {
    const review = await createBreakGlassRepository(db).createReview({
      grantId: grant.id,
      reviewerId: context.actor.id,
      reviewedAt: now,
      decision,
      notes: reviewNotes,
    })
    await writeGrantAudit(dependencies.audit, context, db, grant, {
      eventType: 'break_glass.review',
      reason: reviewNotes ?? 'Break-glass access reviewed.',
      reasonCode: decision,
    })
    return reviewResponse(review)
  })
}