import { AppError } from '../../../shared/errors'
import type { AuditCursor } from '../store'

// nextCursor is a UTC timestamp with microsecond precision, a colon and the
// audit id. The timestamp is kept as text so microseconds survive the round
// trip through JavaScript's millisecond Date.
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z):([1-9][0-9]{0,17})$/

export function parseAuditCursor(value: string | undefined): AuditCursor | null {
  if (value === undefined) return null
  const match = CURSOR.exec(value)
  if (match === null || !isCalendarTimestamp(match[1]!)) throw invalidCursor()
  return { occurredAt: match[1]!, id: match[2]! }
}

function isCalendarTimestamp(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19)
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', 400, 'The audit cursor is not valid.')
}
