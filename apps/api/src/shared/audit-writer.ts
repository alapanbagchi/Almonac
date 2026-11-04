import type { DatabaseQuery } from '../db/pool'

export type AuditActorType = 'user' | 'system' | 'service' | 'break_glass'
export type AuditOutcome = 'success' | 'failure' | 'denied'
export type AuditMetadata = Record<string, string | number | boolean | null>

export interface AuditEvent {
  readonly actorUserId: string | null
  readonly actorType: AuditActorType
  readonly sessionId: string | null
  readonly organisationId: string | null
  readonly hospitalId: string | null
  readonly eventType: string
  readonly outcome: AuditOutcome
  readonly targetType?: string | null
  readonly targetId?: string | null
  readonly requestId?: string | null
  readonly reason?: string | null
  readonly reasonCode?: string | null
  readonly ip?: string | null
  readonly userAgentHash?: Buffer | null
  readonly metadata?: AuditMetadata
}

export interface AuditSink {
  write(event: AuditEvent, db?: DatabaseQuery): Promise<void>
}

/**
 * Append one security event. The database catalogue rejects unknown event
 * types, missing reasons and metadata keys outside the allowlist. There is no
 * catch: a sensitive action must fail when its audit record cannot be written.
 */
export function createAuditWriter(db: DatabaseQuery): AuditSink {
  return {
    async write(event, transaction = db) {
      await transaction.query(
        `insert into audit.event
           (actor_user_id, actor_type, session_id, organisation_id, hospital_id,
            event_type, outcome, target_type, target_id, request_id, reason,
            reason_code, ip, user_agent_hash, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          event.actorUserId,
          event.actorType,
          event.sessionId,
          event.organisationId,
          event.hospitalId,
          event.eventType,
          event.outcome,
          event.targetType ?? null,
          event.targetId ?? null,
          event.requestId ?? null,
          event.reason ?? null,
          event.reasonCode ?? null,
          event.ip ?? null,
          event.userAgentHash ?? null,
          JSON.stringify(event.metadata ?? {}),
        ],
      )
    },
  }
}
