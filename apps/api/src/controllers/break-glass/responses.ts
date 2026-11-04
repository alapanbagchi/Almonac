import type { BreakGlassGrant, BreakGlassReview } from '../../repositories/break-glass-repository'

/** The wire shape of a grant: every instant is ISO 8601, never a Date. */
export function grantResponse(grant: BreakGlassGrant) {
  return {
    id: grant.id,
    organisationId: grant.organisationId,
    hospitalId: grant.hospitalId,
    userId: grant.userId,
    approvedBy: grant.approvedBy,
    approvalMode: grant.approvalMode,
    reason: grant.reason,
    accessLevel: grant.accessLevel,
    status: grant.status,
    startsAt: grant.startsAt.toISOString(),
    endsAt: grant.endsAt.toISOString(),
    approvedAt: grant.approvedAt.toISOString(),
    activatedAt: grant.activatedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    expiredAt: grant.expiredAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
  }
}

export type GrantResponse = ReturnType<typeof grantResponse>

export function reviewResponse(review: BreakGlassReview) {
  return {
    id: review.id,
    grantId: review.grantId,
    reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt.toISOString(),
    decision: review.decision,
    notes: review.notes,
  }
}

export type ReviewResponse = ReturnType<typeof reviewResponse>
