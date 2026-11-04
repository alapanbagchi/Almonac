import { requireAssurance } from '../../auth/assurance'
import { withTransaction } from '../../db/pool'
import { conflict, notFound, ruleViolation } from '../../shared/errors'
import {
  createBreakGlassRepository,
  type BreakGlassGrant,
  type BreakGlassHospital,
  type BreakGlassRepository,
} from '../../repositories/break-glass-repository'
import { grantResponse, type GrantResponse } from './responses'
import {
  BREAK_GLASS_ASSURANCE,
  changeMetadata,
  durationOf,
  nowOf,
  normaliseReason,
  requireActiveMembership,
  requireApprover,
  writeGrantAudit,
  type BreakGlassContext,
  type BreakGlassDependencies,
} from './support'

export type RequestGrantInput =
  | {
      readonly hospitalId: string
      readonly mode: 'emergency'
      readonly reason: string
      readonly durationMinutes?: number
    }
  | {
      readonly hospitalId: string
      readonly mode: 'pre_approved'
      readonly reason: string
      readonly durationMinutes?: number
      readonly userId: string
    }

/**
 * Opens an emergency grant. A requester opens their own live grant; an
 * approver opens one for somebody else that the person must then activate.
 */
export async function requestGrant(
  dependencies: BreakGlassDependencies,
  context: BreakGlassContext,
  input: RequestGrantInput,
): Promise<GrantResponse> {
  const now = nowOf(dependencies)

  if (input.mode === 'pre_approved') {
    await requireApprover(dependencies, context.actor.id)
    requireAssurance(context, BREAK_GLASS_ASSURANCE, now)
    if (input.userId === context.actor.id) {
      throw ruleViolation('You cannot approve your own emergency access.')
    }

    const hospital = await requireHospital(dependencies, input.hospitalId)
    const subject = await dependencies.users.findById(input.userId)
    if (subject === null || subject.status !== 'active') {
      throw ruleViolation('The person is not an active member of the platform.')
    }
    await acceptRequester(dependencies, subject.id, hospital, now)

    const reason = normaliseReason(input.reason)
    return withTransaction(dependencies.pool, async (db) => {
      const grants = createBreakGlassRepository(db)
      const grant = await createGrant(grants, {
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
      await writeGrantAudit(dependencies.audit, context, db, grant, {
        eventType: 'admin.change',
        reasonCode: 'break_glass.approved',
        metadata: changeMetadata(grant.id),
      })
      return grantResponse(grant)
    })
  }

  const hospital = await requireHospital(dependencies, input.hospitalId)
  await dependencies.authorize(context.actor.id, 'break_glass.request', {
    organisationId: hospital.organisationId,
    hospitalId: hospital.id,
  })
  requireAssurance(context, BREAK_GLASS_ASSURANCE, now)
  await acceptRequester(dependencies, context.actor.id, hospital, now)

  return withTransaction(dependencies.pool, async (db) => {
    const grants = createBreakGlassRepository(db)
    const grant = await createGrant(grants, {
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
    await writeGrantAudit(dependencies.audit, context, db, grant, {
      eventType: 'break_glass.activate',
      reasonCode: 'break_glass.emergency',
    })
    return grantResponse(grant)
  })
}

async function requireHospital(
  dependencies: BreakGlassDependencies,
  hospitalId: string,
): Promise<BreakGlassHospital> {
  const hospital = await createBreakGlassRepository(dependencies.pool).findHospital(hospitalId)
  if (hospital === null || hospital.status !== 'active') throw notFound('Hospital not found.')
  return hospital
}

async function acceptRequester(
  dependencies: BreakGlassDependencies,
  userId: string,
  hospital: BreakGlassHospital,
  now: Date,
): Promise<void> {
  const grants = createBreakGlassRepository(dependencies.pool)
  await requireActiveMembership(grants, userId, hospital, now)
  const open = await grants.findOpenForUserAtHospital(userId, hospital.id, now)
  if (open !== null) {
    throw conflict('The person already has an open emergency grant for this hospital.')
  }
}

async function createGrant(
  grants: BreakGlassRepository,
  input: {
    readonly organisationId: string
    readonly hospitalId: string
    readonly userId: string
    readonly approvedBy: string | null
    readonly approvalMode: 'pre_approved' | 'emergency'
    readonly reason: string
    readonly status: 'approved' | 'active'
    readonly now: Date
    readonly durationMinutes: number
  },
): Promise<BreakGlassGrant> {
  const endsAt = new Date(input.now.getTime() + input.durationMinutes * 60_000)
  return grants.create({
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
}
