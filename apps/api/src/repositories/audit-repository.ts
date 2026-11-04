import { dateField, nullableStringField, rowRecord, stringField } from '../db/rows'
import type { DatabaseQuery } from '../db/pool'

export interface AuditEntry {
  readonly id: string
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

/** A row's position in the (occurred_at, id) ordering the query pages by. */
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

export interface AuditPage {
  readonly entries: AuditEntry[]
  /** Position of the last entry, or null when the page is empty. */
  readonly nextCursor: string | null
}

export interface AuditRepository {
  list(input: AuditListInput): Promise<AuditPage>
}

/**
 * Read-only SQL over the append-only audit log; the runtime role holds SELECT
 * and INSERT only, so there is no mutation path to expose.
 */
export function createAuditRepository(db: DatabaseQuery): AuditRepository {
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
      const rows = result.rows.map(mapRow)
      return {
        entries: rows.map((row) => row.entry),
        nextCursor: rows.at(-1)?.cursor ?? null,
      }
    },
  }
}

/** The cursor is the row's position, so it is built once beside the query that orders by it. */
function mapRow(value: unknown): { entry: AuditEntry; cursor: string } {
  const row = rowRecord(value)
  const id = stringField(row, 'id')
  return {
    cursor: `${stringField(row, 'occurred_at_cursor')}:${id}`,
    entry: {
      id,
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
    },
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
