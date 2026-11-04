import type { Pool } from 'pg'
import { AppError } from '../shared/errors'
import { AuditWriter } from '../audit/audit-writer'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { UserLookup } from '../auth/bearer'
import { requireAssurance, type AssurancePolicy } from '../auth/assurance'
import { withTransaction } from '../db/pool'
import type { Page, PageRequest } from '../shared/pagination'
import type { AppUser } from '../identity/app-user-repository'
import {
  BreakGlassConstraintError,
  BreakGlassRepository,
  isOverlapViolation,
  type BreakGlassDecision,
  type BreakGlassGrant,
  type BreakGlassReview,
} from './break-glass-repository'

export const BREAK_GLASS_DEFAULT_MINUTES = 60
export const BREAK_GLASS_MAX_MINUTES = 240

/**
 * Emergency access is only useful when the person asking for it is present and
 * recently authenticated. A password-only session must step up first.
 */
export const BREAK_GLASS_ASSURANCE: AssurancePolicy = {
  minimumAal: 2,
  maxAuthAgeSeconds: 5 * 60,
}

export interface BreakGlassContext {
  readonly actor: AppUser
  readonly sessionId: string
  readonly aal: number
  readonly amr: readonly string[]
  readonly authTime: Date
  readonly requestId: string
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

export interface BreakGlassDependencies {
  readonly pool: Pool
  readonly authorization: AuthorizationRepository
  readonly users: UserLookup
  readonly clock?: () => Date
}

export type CreateBreakGlassInput = {
  readonly hospitalId: string
  readonly reason: string
  readonly durationMinutes?: number
}

export interface CreatePreApprovedInput extends CreateBreakGlassInput {
  readonly userId: string
}

/**
 * Break-glass lifecycle. The database enforces the hard limits (scope,
 * approval independence, non-overlap, four-hour maximum, final states); this
 * service adds identity, permission, membership and assurance checks and writes
 * the audit record for every state change.
 */
export class BreakGlassService {
  private readonly clock: () => Date

  constructor(private readonly dependencies: BreakGlassDependencies) {
    this.clock = dependencies.clock ?? (() => new Date())
  }

  async requestEmergency(
    context: BreakGlassContext,
    input: CreateBreakGlassInput,
  ): Promise<BreakGlassGrant> {
    const now = this.clock()
    const hospital = await this.requireHospital(input.hospitalId)
    await this.requireRequestPermission(context, hospital.organisationId, hospital.id)
    requireAssurance(context, BREAK_GLASS_ASSURANCE, now)
    await this.requireActiveMembership(context.actor.id, hospital, now)
    await this.requireNoOpenGrant(context.actor.id, hospital.id, now)

    return withTransaction(this.dependencies.pool, async (db) => {
      const grants = new BreakGlassRepository(db)
      const grant = await this.createGrant(grants, {
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
        userId: context.actor.id,
        approvedBy: null,
        approvalMode: 'emergency',
        reason: normaliseReason(input.reason),
        status: 'active',
        now,
        durationMinutes: durationOf(input.durationMinutes),
      })
      await new AuditWriter(db).write({
        actorUserId: context.actor.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
        eventType: 'break_glass.activate',
        outcome: 'success',
        targetType: 'break_glass_grant',
        targetId: grant.id,
        requestId: context.requestId,
        reason: grant.reason,
        reasonCode: 'break_glass.emergency',
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: { grant_id: grant.id },
      })
      return grant
    })
  }

  async createPreApproved(
    context: BreakGlassContext,
    input: CreatePreApprovedInput,
  ): Promise<BreakGlassGrant> {
    const now = this.clock()
    await this.requireApprover(context)
    requireAssurance(context, BREAK_GLASS_ASSURANCE, now)
    if (input.userId === context.actor.id) {
      throw invalid('You cannot approve your own emergency access.')
    }

    const hospital = await this.requireHospital(input.hospitalId)
    const subject = await this.dependencies.users.findById(input.userId)
    if (subject === null || subject.status !== 'active') {
      throw invalid('The person is not an active member of the platform.')
    }
    await this.requireActiveMembership(subject.id, hospital, now)
    await this.requireNoOpenGrant(subject.id, hospital.id, now)

    const reason = normaliseReason(input.reason)
    return withTransaction(this.dependencies.pool, async (db) => {
      const grants = new BreakGlassRepository(db)
      const grant = await this.createGrant(grants, {
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
        userId: subject.id,
        approvedBy: context.actor.id,
        approvalMode: 'pre_approved',
        reason,
        status: 'approved',
        now,
        durationMinutes: durationOf(input.durationMinutes),
      })
      await new AuditWriter(db).write({
        actorUserId: context.actor.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
        eventType: 'admin.change',
        outcome: 'success',
        targetType: 'break_glass_grant',
        targetId: grant.id,
        requestId: context.requestId,
        reason: grant.reason,
        reasonCode: 'break_glass.approved',
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: {
          resource_type: 'break_glass_grant',
          resource_id: grant.id,
        },
      })
      return grant
    })
  }

  async activate(context: BreakGlassContext, grantId: string): Promise<BreakGlassGrant> {
    const now = this.clock()
    const grant = await new BreakGlassRepository(this.dependencies.pool).findById(grantId)
    if (grant === null) throw notFound()
    if (grant.userId !== context.actor.id) throw forbidden()
    if (grant.status !== 'approved') throw conflict('The grant is not awaiting activation.')
    if (grant.endsAt <= now) throw conflict('The grant has expired.')
    requireAssurance(context, BREAK_GLASS_ASSURANCE, now)
    await this.requireActiveMembership(
      context.actor.id,
      { id: grant.hospitalId, organisationId: grant.organisationId },
      now,
    )

    return withTransaction(this.dependencies.pool, async (db) => {
      const updated = await new BreakGlassRepository(db).activate(grant.id, context.actor.id, now)
      if (updated === null) throw conflict('The grant can no longer be activated.')
      await new AuditWriter(db).write({
        actorUserId: context.actor.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: updated.organisationId,
        hospitalId: updated.hospitalId,
        eventType: 'break_glass.activate',
        outcome: 'success',
        targetType: 'break_glass_grant',
        targetId: updated.id,
        requestId: context.requestId,
        reason: updated.reason,
        reasonCode: 'break_glass.activated',
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: { grant_id: updated.id },
      })
      return updated
    })
  }

  async revoke(context: BreakGlassContext, grantId: string, reason: string): Promise<BreakGlassGrant> {
    const now = this.clock()
    const grant = await new BreakGlassRepository(this.dependencies.pool).findById(grantId)
    if (grant === null) throw notFound()
    if (grant.userId !== context.actor.id && !(await this.isApprover(context))) {
      throw forbidden()
    }
    const revokeReason = normaliseReason(reason)

    return withTransaction(this.dependencies.pool, async (db) => {
      const revoked = await new BreakGlassRepository(db).revoke(grant.id, now)
      if (revoked === null) throw conflict('The grant is already closed.')
      await new AuditWriter(db).write({
        actorUserId: context.actor.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: revoked.organisationId,
        hospitalId: revoked.hospitalId,
        eventType: 'admin.change',
        outcome: 'success',
        targetType: 'break_glass_grant',
        targetId: revoked.id,
        requestId: context.requestId,
        reason: revokeReason,
        reasonCode: 'break_glass.revoked',
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: {
          resource_type: 'break_glass_grant',
          resource_id: revoked.id,
        },
      })
      return revoked
    })
  }

  async review(
    context: BreakGlassContext,
    grantId: string,
    decision: BreakGlassDecision,
    notes: string | null,
  ): Promise<BreakGlassReview> {
    const now = this.clock()
    await this.requireApprover(context)
    const grant = await new BreakGlassRepository(this.dependencies.pool).findById(grantId)
    if (grant === null) throw notFound()
    if (grant.userId === context.actor.id || grant.approvedBy === context.actor.id) {
      throw forbidden()
    }
    if (grant.endsAt > now) throw conflict('Access must end before it is reviewed.')
    if (!['upheld', 'overturned', 'escalated'].includes(decision)) {
      throw invalid('The review decision is not valid.')
    }
    const reviewNotes = notes?.trim() || null
    if (reviewNotes !== null && reviewNotes.length > 1_000) {
      throw invalid('Review notes are too long.')
    }

    return withTransaction(this.dependencies.pool, async (db) => {
      let review: BreakGlassReview
      try {
        review = await new BreakGlassRepository(db).createReview({
          grantId: grant.id,
          reviewerId: context.actor.id,
          reviewedAt: now,
          decision,
          notes: reviewNotes,
        })
      } catch (error) {
        if (error instanceof BreakGlassConstraintError) {
          throw conflict('This grant cannot be reviewed again.')
        }
        throw error
      }
      await new AuditWriter(db).write({
        actorUserId: context.actor.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: grant.organisationId,
        hospitalId: grant.hospitalId,
        eventType: 'break_glass.review',
        outcome: 'success',
        targetType: 'break_glass_grant',
        targetId: grant.id,
        requestId: context.requestId,
        reason: reviewNotes ?? 'Break-glass access reviewed.',
        reasonCode: decision,
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: { grant_id: grant.id },
      })
      return review
    })
  }

  async list(
    context: BreakGlassContext,
    hospitalId: string | null,
    page: PageRequest,
  ): Promise<Page<BreakGlassGrant>> {
    const approver = await this.isApprover(context)
    const userId = approver ? null : context.actor.id
    return new BreakGlassRepository(this.dependencies.pool).list(userId, hospitalId, page)
  }

  private async createGrant(
    grants: BreakGlassRepository,
    input: {
      organisationId: string
      hospitalId: string
      userId: string
      approvedBy: string | null
      approvalMode: 'pre_approved' | 'emergency'
      reason: string
      status: 'approved' | 'active'
      now: Date
      durationMinutes: number
    },
  ): Promise<BreakGlassGrant> {
    const endsAt = new Date(input.now.getTime() + input.durationMinutes * 60_000)
    try {
      return await grants.create({
        organisationId: input.organisationId,
        hospitalId: input.hospitalId,
        userId: input.userId,
        approvedBy: input.approvedBy,
        approvalMode: input.approvalMode,
        reason: input.reason,
        status: input.status,
        startsAt: input.now,
        endsAt,
        activatedAt: input.status === 'active' ? input.now : null,
        activatedBy: input.status === 'active' ? input.userId : null,
      })
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw conflict('An overlapping emergency grant already exists.')
      }
      throw error
    }
  }

  private async requireHospital(hospitalId: string) {
    const hospital = await new BreakGlassRepository(this.dependencies.pool).findHospital(hospitalId)
    if (hospital === null || hospital.status !== 'active') {
      throw notFound('Hospital not found.')
    }
    return hospital
  }

  private async requireRequestPermission(
    context: BreakGlassContext,
    organisationId: string,
    hospitalId: string,
  ): Promise<void> {
    const allowed = await this.dependencies.authorization.hasPermission(
      context.actor.id,
      'break_glass.request',
      { organisationId, hospitalId },
    )
    if (!allowed) throw forbidden()
  }

  private async requireApprover(context: BreakGlassContext): Promise<void> {
    if (!(await this.isApprover(context))) throw forbidden()
  }

  private async isApprover(context: BreakGlassContext): Promise<boolean> {
    return (
      (await this.dependencies.authorization.hasPlatformPermission(
        context.actor.id,
        'break_glass.approve',
      )) ||
      (await this.dependencies.authorization.hasPlatformPermission(
        context.actor.id,
        'platform.manage',
      ))
    )
  }

  private async requireActiveMembership(
    userId: string,
    hospital: { id: string; organisationId: string },
    at: Date,
  ): Promise<void> {
    const active = await new BreakGlassRepository(
      this.dependencies.pool,
    ).hasActiveMembership(userId, hospital.organisationId, hospital.id, at)
    if (!active) throw invalid('The person has no current access to this hospital.')
  }

  private async requireNoOpenGrant(
    userId: string,
    hospitalId: string,
    at: Date,
  ): Promise<void> {
    const open = await new BreakGlassRepository(
      this.dependencies.pool,
    ).findOpenForUserAtHospital(userId, hospitalId, at)
    if (open !== null) {
      throw conflict('The person already has an open emergency grant for this hospital.')
    }
  }

}

function durationOf(value: number | undefined): number {
  const minutes = value ?? BREAK_GLASS_DEFAULT_MINUTES
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > BREAK_GLASS_MAX_MINUTES) {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      `durationMinutes must be between 1 and ${BREAK_GLASS_MAX_MINUTES}.`,
    )
  }
  return minutes
}

function normaliseReason(value: string): string {
  const reason = value.trim()
  if (reason.length === 0 || reason.length > 500) {
    throw new AppError('VALIDATION_FAILED', 400, 'A reason of 1 to 500 characters is required.')
  }
  return reason
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
}

function notFound(message = 'Break-glass grant not found.'): AppError {
  return new AppError('NOT_FOUND', 404, message)
}

function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message)
}

function invalid(message: string): AppError {
  return new AppError('RULE_VIOLATION', 422, message)
}
