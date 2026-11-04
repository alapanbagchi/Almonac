import type { AuditSink } from '../audit/audit-writer'
import type { DatabaseQuery } from '../db/pool'
import type { AdminRequestContext } from '../guards/admin-context'

/** What an administrator changed, in the words of the audit catalogue. */
export interface AdminChange {
  readonly targetType: 'organisation' | 'hospital' | 'hospital_domain' | 'membership' | 'invitation'
  readonly targetId: string
  readonly organisationId: string
  readonly hospitalId: string | null
}

export type AdminEventType = 'admin.change' | 'membership.change' | 'role.assign'

/** Human wording for an audit reason code: 'hospital.domain_added' → 'hospital domain added'. */
export function humanReason(code: string): string {
  return code.replace(/[._]/g, ' ').slice(0, 500)
}

/**
 * Append one administrative change, inside the caller's transaction when the
 * change itself is transactional. The event is 'admin.change' unless the
 * catalogue names a more specific one.
 */
export async function recordAdminChange(
  audit: AuditSink,
  context: AdminRequestContext,
  change: AdminChange,
  reasonCode: string,
  db?: DatabaseQuery,
  options: {
    eventType?: AdminEventType
    metadata?: Readonly<Record<string, string | number | boolean | null>>
    reason?: string
  } = {},
): Promise<void> {
  await audit.write(
    {
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId: change.organisationId,
      hospitalId: change.hospitalId,
      eventType: options.eventType ?? 'admin.change',
      outcome: 'success',
      targetType: change.targetType,
      targetId: change.targetId,
      requestId: context.requestId,
      reason: options.reason ?? humanReason(reasonCode),
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: options.metadata,
    },
    db,
  )
}
