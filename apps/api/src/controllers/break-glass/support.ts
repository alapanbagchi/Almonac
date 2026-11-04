import type { Pool } from 'pg'
import type { AuditSink } from '../../audit/audit-writer'
import type { AssurancePolicy } from '../../auth/assurance'
import type { DatabaseQuery } from '../../db/pool'
import type { AppUser } from '../../identity/app-user-repository'
import type { Authorize } from '../../shared/authorize'
import { AppError, forbidden, ruleViolation } from '../../shared/errors'
import type { UserLookup } from '../../guards/bearer'
import type { BreakGlassGrant, BreakGlassRepository } from '../../repositories/break-glass-repository'

export const BREAK_GLASS_DEFAULT_MINUTES = 60
export const BREAK_GLASS_MAX_MINUTES = 240

export const BREAK_GLASS_APPROVER_PERMISSIONS = ['break_glass.approve', 'platform.manage'] as const

/** Break-glass always needs a second factor from the last five minutes. */
export const BREAK_GLASS_ASSURANCE: AssurancePolicy = {
  minimumAal: 2,
  maxAuthAgeSeconds: 5 * 60,
}

/** The authenticated caller plus the request facts every audit event records. */
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
  readonly authorize: Authorize
  /** Approval is platform scope, so it is read without a hospital target. */
  readonly hasAnyPlatformPermission: (
    actorId: string,
    permissions: readonly string[],
  ) => Promise<boolean>
  readonly users: UserLookup
  readonly audit: AuditSink
  readonly clock?: () => Date
}

export function nowOf(dependencies: { readonly clock?: () => Date }): Date {
  return dependencies.clock?.() ?? new Date()
}

export function isApprover(
  dependencies: Pick<BreakGlassDependencies, 'hasAnyPlatformPermission'>,
  actorId: string,
): Promise<boolean> {
  return dependencies.hasAnyPlatformPermission(actorId, BREAK_GLASS_APPROVER_PERMISSIONS)
}

export async function requireApprover(
  dependencies: Pick<BreakGlassDependencies, 'hasAnyPlatformPermission'>,
  actorId: string,
): Promise<void> {
  if (!(await isApprover(dependencies, actorId))) throw forbidden()
}

export async function requireActiveMembership(
  grants: BreakGlassRepository,
  userId: string,
  hospital: { readonly id: string; readonly organisationId: string },
  at: Date,
): Promise<void> {
  const active = await grants.hasActiveMembership(userId, hospital.organisationId, hospital.id, at)
  if (!active) throw ruleViolation('The person has no current access to this hospital.')
}

/** The API never accepts a duration the database window cannot honour. */
export function durationOf(value: number | undefined): number {
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

export function normaliseReason(value: string): string {
  const reason = value.trim()
  if (reason.length === 0 || reason.length > 500) {
    throw new AppError('VALIDATION_FAILED', 400, 'A reason of 1 to 500 characters is required.')
  }
  return reason
}

export interface GrantAuditOptions {
  readonly eventType: string
  readonly reasonCode: string
  readonly reason?: string
  readonly metadata?: Readonly<Record<string, string>>
}

/** One audit envelope for every grant event, written on the grant transaction. */
export async function writeGrantAudit(
  audit: AuditSink,
  context: BreakGlassContext,
  db: DatabaseQuery,
  grant: BreakGlassGrant,
  options: GrantAuditOptions,
): Promise<void> {
  await audit.write(
    {
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId: grant.organisationId,
      hospitalId: grant.hospitalId,
      eventType: options.eventType,
      outcome: 'success',
      targetType: 'break_glass_grant',
      targetId: grant.id,
      requestId: context.requestId,
      reason: options.reason ?? grant.reason,
      reasonCode: options.reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: options.metadata ?? { grant_id: grant.id },
    },
    db,
  )
}

export function changeMetadata(id: string): Readonly<Record<string, string>> {
  return { resource_type: 'break_glass_grant', resource_id: id }
}
