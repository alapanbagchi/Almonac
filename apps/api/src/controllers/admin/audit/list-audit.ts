import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import {
  createAuditRepository,
  type AuditEntry,
} from '../../../repositories/audit-repository'
import { instant } from '../../../shared/instant'
import { auditLimit } from '../../../shared/pagination'
import { parseAuditCursor } from './cursor'

/** An audit entry as the API publishes it. */
export interface AuditEntryResponse {
  readonly id: string
  readonly occurredAt: string
  readonly actorType: AuditEntry['actorType']
  readonly actorUserId: string | null
  readonly sessionId: string | null
  readonly organisationId: string | null
  readonly hospitalId: string | null
  readonly eventType: string
  readonly outcome: AuditEntry['outcome']
  readonly targetType: string | null
  readonly targetId: string | null
  readonly requestId: string | null
  readonly reasonCode: string | null
  readonly metadata: Record<string, string | number | boolean | null>
}

/** Map explicitly: the cursor is a paging handle and never part of an entry. */
export function auditResponse(entry: AuditEntry): AuditEntryResponse {
  return {
    id: entry.id,
    occurredAt: instant(entry.occurredAt),
    actorType: entry.actorType,
    actorUserId: entry.actorUserId,
    sessionId: entry.sessionId,
    organisationId: entry.organisationId,
    hospitalId: entry.hospitalId,
    eventType: entry.eventType,
    outcome: entry.outcome,
    targetType: entry.targetType,
    targetId: entry.targetId,
    requestId: entry.requestId,
    reasonCode: entry.reasonCode,
    metadata: { ...entry.metadata },
  }
}

export interface ListAuditInput {
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly limit?: string
  readonly cursor?: string
}

/**
 * Read one page of the audit log. Authorisation runs before the query so a
 * denied reader never reaches the storage, and the cursor is validated before
 * it becomes a query parameter.
 */
export async function listAudit(
  d: AdminDependencies,
  context: AdminRequestContext,
  input: ListAuditInput,
): Promise<{ entries: AuditEntryResponse[]; nextCursor: string | null }> {
  await d.authorize(context.actor.id, 'audit.read', {
    organisationId: input.organisationId,
    hospitalId: input.hospitalId,
  })

  const page = await createAuditRepository(d.pool).list({
    organisationId: input.organisationId,
    hospitalId: input.hospitalId,
    limit: auditLimit(input.limit),
    cursor: parseAuditCursor(input.cursor),
  })
  return { entries: page.entries.map(auditResponse), nextCursor: page.nextCursor }
}
