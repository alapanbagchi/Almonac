import { instant } from '../../shared/instant'
import type { AuditEntry } from './store'

/** Dates become ISO strings; the response schema promises it. */
export function auditResponse(value: AuditEntry) {
  return { ...value, occurredAt: instant(value.occurredAt) }
}
