import type { AccessTarget } from '../../access/authorization-repository'
import type { AuditEntry, AuditListInput, AuditStore } from './store'

/** The one question every admin use case asks: may this actor do this here? */
export type Authorize = (actorId: string, permission: string, target: AccessTarget) => Promise<void>

export interface AuditAdmin {
  list(actorId: string, input: AuditListInput): Promise<AuditEntry[]>
}

/**
 * Reads one organisation's audit log, optionally narrowed to one hospital.
 * Authorisation is a capability and storage is a port, so this use case has no
 * request, database or permission implementation in it.
 */
export function createAuditAdmin({
  store,
  authorize,
}: {
  store: AuditStore
  authorize: Authorize
}): AuditAdmin {
  return {
    async list(actorId, input) {
      await authorize(actorId, 'audit.read', {
        organisationId: input.organisationId,
        hospitalId: input.hospitalId ?? null,
      })
      return store.list(input)
    },
  }
}
