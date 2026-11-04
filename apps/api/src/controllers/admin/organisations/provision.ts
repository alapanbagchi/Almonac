import { performance } from 'node:perf_hooks'
import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import type { DatabaseQuery } from '../../../db/pool'
import { recordAdminChange } from '../../../shared/change-log'
import { NO_METRICS } from '../../../shared/metrics'
import {
  createOrganisationRepository,
  type Organisation,
} from '../../../repositories/organisation-repository'

export interface ProvisionOrganisationInput {
  readonly name: string
  readonly slug: string
  readonly roleTemplates: readonly string[]
}

export interface ProvisionedOrganisation {
  readonly organisation: Organisation
  readonly roles: ReadonlyMap<string, string>
  readonly provisioned: boolean
}

type ProvisionDependencies = Pick<
  AdminDependencies,
  'transaction' | 'audit' | 'organisationIdentity' | 'metrics'
>

/**
 * Provision an organisation: local row, role catalogue, then the identity
 * provider, all inside one advisory-locked transaction. A provider failure is
 * audited and committed, so the pending row can be retried; the error is then
 * rethrown after the commit.
 */
export async function provisionOrganisation(
  d: ProvisionDependencies,
  context: AdminRequestContext,
  input: ProvisionOrganisationInput,
): Promise<ProvisionedOrganisation> {
  const startedAt = performance.now()
  const result = await d.transaction(async (db) => {
    const organisations = createOrganisationRepository(db)
    await organisations.lockSlug(input.slug)
    const existing = await organisations.findBySlug(input.slug)
    const organisation = existing ?? (await organisations.createPending(input.name, input.slug))
    const roles = await organisations.instantiateRoleTemplates(organisation.id, input.roleTemplates)

    if (organisation.status === 'active') {
      return { organisation, roles, provisioned: false }
    }

    let zitadelOrgId: string
    try {
      zitadelOrgId =
        organisation.zitadelOrgId ?? (await d.organisationIdentity.create(organisation.name))
    } catch (error) {
      await recordProvisioningFailure(d, context, organisation, db)
      return { error }
    }

    const provisioned = await organisations.markProvisioned(organisation.id, zitadelOrgId, new Date())
    await recordAdminChange(
      d.audit,
      context,
      {
        targetType: 'organisation',
        targetId: provisioned.id,
        organisationId: provisioned.id,
        hospitalId: null,
      },
      'organisation.provisioned',
      db,
      {
        reason: 'organisation provisioning',
        metadata: { resource_type: 'organisation', resource_id: provisioned.id },
      },
    )
    return { organisation: provisioned, roles, provisioned: true }
  })

  if ('error' in result) throw result.error
  if (result.provisioned) {
    const metrics = d.metrics ?? NO_METRICS
    metrics.count('admin.provisioning_lag', {
      duration_ms: Math.round(performance.now() - startedAt),
    })
  }
  return result
}

/**
 * recordAdminChange only writes success events, so the failure outcome is
 * assembled here with the same catalogue fields.
 */
async function recordProvisioningFailure(
  d: ProvisionDependencies,
  context: AdminRequestContext,
  organisation: Organisation,
  db: DatabaseQuery,
): Promise<void> {
  await d.audit.write(
    {
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId: organisation.id,
      hospitalId: null,
      eventType: 'admin.change',
      outcome: 'failure',
      targetType: 'organisation',
      targetId: organisation.id,
      requestId: context.requestId,
      reason: 'organisation provisioning failed',
      reasonCode: 'organisation.provision_failed',
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: { resource_type: 'organisation', resource_id: organisation.id },
    },
    db,
  )
}
