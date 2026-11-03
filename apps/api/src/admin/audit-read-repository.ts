import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

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

export interface AuditCursor {
  readonly occurredAt: Date
  readonly id: string
}

/**
 * Read-only view over the append-only audit log. The API never exposes a
 * mutation path; the runtime role holds SELECT and INSERT only.
 */
export class AuditReadRepository {
  constructor(private readonly db: DatabaseQuery) {}

  async list(input: {
    organisationId: string
    hospitalId?: string | null
    limit: number
    cursor?: AuditCursor | null
  }): Promise<AuditEntry[]> {
    const result = await this.db.query(
      `select id::text as id, occurred_at, actor_type, actor_user_id,
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
  }
}

function mapEntry(value: unknown): AuditEntry {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
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
    metadata: readMetadata(row.metadata),
  }
}

function readMetadata(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('database field metadata is not an object')
  }
  const metadata: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (
      item !== null &&
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    ) {
      throw new Error('database field metadata has an unsupported value')
    }
    metadata[key] = item
  }
  return metadata
}
