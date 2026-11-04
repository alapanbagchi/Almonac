import type { AuditCursor } from '../../../repositories/audit-repository'
import { AppError } from '../../../shared/errors'

/** The cursor the list route emits: microseconds since the epoch ordering key. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z):([1-9][0-9]{0,17})$/

function invalid(): AppError {
  return new AppError('VALIDATION_FAILED', 400, 'The audit cursor is not valid.')
}

/**
 * Parse the opaque cursor a previous page returned. A malformed cursor is a
 * client error, so it fails before the query rather than paging from the start.
 */
export function parseAuditCursor(value: string | undefined): AuditCursor | null {
  if (value === undefined) return null
  const match = CURSOR.exec(value)
  if (match === null) throw invalid()
  const occurredAt = match[1]
  const id = match[2]
  if (occurredAt === undefined || id === undefined || !isCalendarTimestamp(occurredAt)) {
    throw invalid()
  }
  return { occurredAt, id }
}

/** PostgreSQL prints UTC microsecond timestamps; reject a date that never existed. */
function isCalendarTimestamp(value: string): boolean {
  const parsed = new Date(value)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 19) === value.slice(0, 19)
  )
}
