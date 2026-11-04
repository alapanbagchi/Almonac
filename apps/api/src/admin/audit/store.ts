import type { DatabaseQuery } from '../../db/pool'
import { dateField, nullableStringField, rowRecord, stringField } from '../../db/rows'

export interface AuditEntry {
  readonly id: string
  /** Opaque pagination token for the next page; not part of the response body. */
  readonly cursor: string
  readonly occurredAt: Date
  readonly actorType: 'user' | 'system' | 'service' | 'break_glass'
  readonly actorUserId: string | null
  readonly sessionId: string | null
  readonly organisationId: string | null
  readonly hospitalId: string | null
  readonly eventType: string
  readonly outcome: 'success' | 'failure' | 'denied'
  readonly targetType: string | null
  readonly targetId: string | null
  readonly requestId: string | null
  readonly reasonCode: string | null
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>
}

export interface AuditCursor {
  /** UTC timestamp with microsecond precision, as produced by PostgreSQL. */
  readonly occurredAt: string
  readonly id: string
}

export interface AuditListInput {
  readonly organisationId: string
  readonly hospitalId?: string | null
  readonly limit: number
  readonly cursor?: AuditCursor | null
}

/** The only thing the service needs from storage. */
export interface AuditStore {
  list(input: AuditListInput): Promise<AuditEntry[]>
}

/**
 * Read-only SQL over the append-only audit log. The API never exposes a
 * mutation path; the runtime role holds SELECT and INSERT only.
 */
export function createAuditStore(db: DatabaseQuery): AuditStore {
  return {
    async list(input) {
      const result = await db.query(
        `select id::text as id,
                occurred_at,
                to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_at_cursor,
                actor_type, actor_user_id,
                session_id, organisation_id, hospital_id, event_type, outcome,
                target_type, target_id, request_id, reason_code, metadata
           from audit.event
          where organisation_id = $1
            and ($2::uuid is null or hospital_id = $2)
            and (
              $3::timestamptz is null
              or (occurred_at, id) < ($3::timestamptz, $4::bigint)
            )
          order by occurred_at desc, id desc
          limit $5`,
        [
          input.organisationId,
          input.hospitalId ?? null,
          input.cursor?.occurredAt ?? null,
          input.cursor?.id ?? null,
          input.limit,
        ],
      )
      return result.rows.map(mapEntry)
    },
  }
}

function mapEntry(value: unknown): AuditEntry {
  const row = rowRecord(value)
  const id = stringField(row, 'id')
  // The cursor is the row's position, so it is built once here, next to the
  // query that orders by it.
  const cursor = `${stringField(row, 'occurred_at_cursor')}:${id}`
  return {
    id,
    cursor,
    occurredAt: dateField(row, 'occurred_at'),
    actorType: stringField(row, 'actor_type') as AuditEntry['actorType'],
    actorUserId: nullableStringField(row, 'actor_user_id'),
    sessionId: nullableStringField(row, 'session_id'),
    organisationId: nullableStringField(row, 'organisation_id'),
    hospitalId: nullableStringField(row, 'hospital_id'),
    eventType: stringField(row, 'event_type'),
    outcome: stringField(row, 'outcome') as AuditEntry['outcome'],
    targetType: nullableStringField(row, 'target_type'),
    targetId: nullableStringField(row, 'target_id'),
    requestId: nullableStringField(row, 'request_id'),
    reasonCode: nullableStringField(row, 'reason_code'),
    metadata: auditMetadata(row.metadata),
  }
}

/** Audit metadata is flat scalars by database constraint; anything else is a bug. */
function auditMetadata(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('database field metadata is not an object')
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        throw new Error('database field metadata has an unsupported value')
      }
      return [key, item]
    }),
  )
}
