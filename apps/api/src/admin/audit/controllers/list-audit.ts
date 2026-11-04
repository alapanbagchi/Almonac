import { auditLimit } from '../../../shared/pagination'
import type { AuditAdmin } from '../service'
import { auditResponse } from '../responses'
import { parseAuditCursor } from '../validators/cursor'
import type { AuditQuery } from '../validators/audit-query'

/**
 * One page of the audit log. The route passes values; this function owns the
 * cursor and the response shape, never the status code.
 */
export async function listAudit(
  audit: AuditAdmin,
  actorId: string,
  organisationId: string,
  query: AuditQuery,
) {
  const entries = await audit.list(actorId, {
    organisationId,
    hospitalId: query.hospitalId ?? null,
    limit: auditLimit(query.limit),
    cursor: parseAuditCursor(query.cursor),
  })
  return { entries: entries.map(auditResponse), nextCursor: entries.at(-1)?.cursor ?? null }
}
