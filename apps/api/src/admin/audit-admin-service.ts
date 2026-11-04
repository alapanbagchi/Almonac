import type { AuthorizationRepository } from '../access/authorization-repository'
import { requireAdminPermission } from './admin-authorization'
import type { AdminRequestContext } from './admin-context'
import type { AuditCursor, AuditEntry, AuditReadRepository } from './audit-read-repository'

export class AuditAdminService {
  constructor(
    private readonly audit: AuditReadRepository,
    private readonly authorization: AuthorizationRepository,
  ) {}

  async list(
    context: AdminRequestContext,
    input: {
      organisationId: string
      hospitalId?: string | null
      limit: number
      cursor?: AuditCursor | null
    },
  ): Promise<AuditEntry[]> {
    await requireAdminPermission(this.authorization, context.actor.id, 'audit.read', {
      organisationId: input.organisationId,
      hospitalId: input.hospitalId ?? null,
    })
    return this.audit.list(input)
  }
}
