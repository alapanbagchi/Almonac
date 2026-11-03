import { AppError } from '../shared/errors'
import type { AuthorizationRepository } from '../access/authorization-repository'
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
    const allowed =
      (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) ||
      (await this.authorization.hasPermission(context.actor.id, 'audit.read', {
        organisationId: input.organisationId,
        hospitalId: input.hospitalId ?? null,
      }))
    if (!allowed) throw new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
    return this.audit.list(input)
  }
}
