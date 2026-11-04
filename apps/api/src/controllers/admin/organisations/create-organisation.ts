import { performance } from 'node:perf_hooks'
import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import type { DatabaseQuery } from '../../../db/pool'
import { recordAdminChange } from '../../../shared/change-log'
import { forbidden } from '../../../shared/errors'
import { NO_METRICS } from '../../../shared/metrics'
import {
  createOrganisationRepository,
  type Organisation,
} from '../../../repositories/organisation-repository'
import { organisationResponse, type OrganisationResponse } from './responses'

export interface CreateOrganisationInput {
  readonly name: string
  readonly slug: string
}

/** The one provider call provisioning needs, injectable so tests never reach Zitadel. */
export interface OrganisationIdentity {
  create(name: string): Promise<string>
}

const ROLE_TEMPLATES = ['org_admin', 'hospital_admin', 'clinician', 'auditor'] as const

type ProvisionResult =
  | { readonly ok: true; readonly organisation: Organisation; readonly provisioned: boolean }
  | { readonly ok: false; readonly error: unknown }

/**
 * Provision an organisation: local row, role catalogue, then the identity
 * provider, all inside one advisory-locked transaction. A provider failure is
 * audited and committed, so the pending row can be retried; the error is then
 * rethrown after the commit.
 */
export async function createOrganisation(
  d: AdminDependencies,
  context: AdminRequestContext,
  input: CreateOrganisationInput,
  identity: OrganisationIdentity,
): Promise<OrganisationResponse> {
  if (!(await d.isPlatformAdmin(context.actor.id))) throw forbidden()

  const startedAt = performance.now()
  const result = await d.transaction(async (db) => {
    const organisations = createOrganisationRepository(db)
    await organisations.lockSlug(input.slug)
    const existing = await organisations.findBySlug(input.slug)
    const organisation = existing ?? (await organisations.createPending(input.name, input.slug))
    await organisations.instantiateRoleTemplates(organisation.id, ROLE_TEMPLATES)

    if (organisation.status === 'active') {
      return { ok: true, organisation, provisioned: false } satisfies ProvisionResult
    }

    let zitadelOrgId: string
    try {
      zitadelOrgId = organisation.zitadelOrgId ?? (await identity.create(organisation.name))
    } catch (error) {
      await recordProvisioningFailure(d, context, organisation, db)
      return { ok: false, error } satisfies ProvisionResult
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
    return { ok: true, organisation: provisioned, provisioned: true } satisfies ProvisionResult
  })

  if (!result.ok) throw result.error
  if (result.provisioned) {
    const metrics = d.metrics ?? NO_METRICS
    metrics.count('admin.provisioning_lag', {
      duration_ms: Math.round(performance.now() - startedAt),
    })
  }
  return organisationResponse(result.organisation)
}

/**
 * recordAdminChange only writes success events, so the failure outcome is
 * assembled here with the same catalogue fields.
 */
async function recordProvisioningFailure(
  d: AdminDependencies,
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
