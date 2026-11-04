import type { Pool } from 'pg'
import type { AuditSink } from '../../audit/audit-writer'
import type { Authorize, PlatformAdmin, RolePermissions } from '../../shared/authorize'
import type { SessionAuthenticator, UserLookup } from '../../guards/bearer'

/**
 * What every admin controller receives. Repositories are built from the pool
 * (or from a transaction client) inside the controller, so this object holds
 * only capabilities: policy, audit, identity and the connection pool.
 */
export interface AdminDependencies {
  readonly pool: Pool
  readonly authorize: Authorize
  readonly permissions: RolePermissions
  readonly isPlatformAdmin: PlatformAdmin
  readonly audit: AuditSink
  readonly sessions: SessionAuthenticator
  readonly users: UserLookup
}
