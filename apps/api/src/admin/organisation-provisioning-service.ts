import type { Pool, PoolClient } from 'pg'
import type { AuditSink } from '../audit/audit-writer'
import { AuditWriter } from '../audit/audit-writer'
import { NO_METRICS, type Metrics } from '../shared/metrics'
import { asAdminError } from './admin-errors'
import { OrganisationRepository, type Organisation } from './organisation-repository'
import type { ZitadelManagementClient } from './zitadel-management-client'

export class OrganisationProvisioningService {
  constructor(
    private readonly pool: Pool,
    private readonly zitadel: ZitadelManagementClient,
    private readonly audit: AuditSink,
    private readonly metrics: Metrics = NO_METRICS,
  ) {}

  /**
   * Create the local organisation first, then the Zitadel organisation. The
   * local row stays pending when Zitadel fails, so a retry can finish the same
   * provisioning instead of creating a second identity tenant.
   */
  async provision(input: { name: string; slug: string }): Promise<Organisation> {
    const startedAt = performance.now()
    const client = await this.pool.connect()
    try {
      await client.query('select pg_advisory_lock(hashtext($1))', [input.slug])
      const db = { query: (text: string, values?: unknown[]) => client.query(text, values) }
      const organisations = new OrganisationRepository(db)
      const audit = this.audit instanceof AuditWriter ? new AuditWriter(db) : this.audit

      const existing = await organisations.findBySlug(input.slug)
      const organisation =
        existing ?? (await organisations.createPending(input.name, input.slug))
      if (organisation.status === 'active') return organisation

      try {
        const zitadelOrgId =
          organisation.zitadelOrgId ?? (await this.zitadel.createOrganisation(input.name))
        const provisioned = await organisations.markProvisioned(
          organisation.id,
          zitadelOrgId,
          new Date(),
        )
        await audit.write({
          actorUserId: null,
          actorType: 'system',
          sessionId: null,
          organisationId: provisioned.id,
          hospitalId: null,
          eventType: 'admin.change',
          outcome: 'success',
          targetType: 'organisation',
          targetId: provisioned.id,
          reason: 'organisation provisioning',
          reasonCode: 'organisation.provision',
          metadata: {
            resource_type: 'organisation',
            resource_id: provisioned.id,
          },
        })
        this.metrics.count('admin.provisioning_lag', {
          duration_ms: Math.round(performance.now() - startedAt),
        })
        return provisioned
      } catch (error) {
        try {
          await audit.write({
            actorUserId: null,
            actorType: 'system',
            sessionId: null,
            organisationId: organisation.id,
            hospitalId: null,
            eventType: 'admin.change',
            outcome: 'failure',
            targetType: 'organisation',
            targetId: organisation.id,
            reason: 'organisation provisioning failed',
            reasonCode: 'organisation.provision_failed',
            metadata: {
              resource_type: 'organisation',
              resource_id: organisation.id,
            },
          })
        } catch {
          // The provider failure is the outcome that matters; do not mask it.
        }
        throw asAdminError(error)
      }
    } finally {
      await releaseLock(client, input.slug)
      client.release()
    }
  }
}

async function releaseLock(client: PoolClient, slug: string): Promise<void> {
  try {
    await client.query('select pg_advisory_unlock(hashtext($1))', [slug])
  } catch {
    // Releasing a broken connection is best effort; the connection is discarded.
  }
}
