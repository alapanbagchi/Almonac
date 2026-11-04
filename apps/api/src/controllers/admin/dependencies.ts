import type { AuditSink } from '../../shared/audit-writer'
import type { DatabaseQuery, TransactionRunner } from '../../db/pool'
import type { Authorize, PlatformAdmin, RolePermissions } from '../../shared/authorize'
import type { Metrics } from '../../shared/metrics'
import type { SessionAuthenticator, UserLookup } from '../../guards/bearer'

/**
 * What every admin controller receives. Repositories are built from `db` (or
 * the transaction client) inside the controller, so this object holds only
 * capabilities: policy, audit, identity, a reader and a transaction runner.
 */
/** The one provider call organisation provisioning needs. */
export interface OrganisationIdentity {
  create(name: string): Promise<string>
}

export interface AdminDependencies {
  readonly db: DatabaseQuery
  readonly transaction: TransactionRunner
  readonly authorize: Authorize
  readonly permissions: RolePermissions
  readonly isPlatformAdmin: PlatformAdmin
  readonly audit: AuditSink
  readonly sessions: SessionAuthenticator
  readonly users: UserLookup
  readonly organisationIdentity: OrganisationIdentity
  /** Optional so existing wiring compiles; provisioning lag is emitted when present. */
  readonly metrics?: Metrics
}
