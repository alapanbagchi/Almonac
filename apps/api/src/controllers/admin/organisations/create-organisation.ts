import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { forbidden } from '../../../shared/errors'
import { provisionOrganisation } from './provision'
import { organisationResponse, type OrganisationResponse } from './responses'

export interface CreateOrganisationInput {
  readonly name: string
  readonly slug: string
}

const ROLE_TEMPLATES = ['org_admin', 'hospital_admin', 'clinician', 'auditor'] as const

/** Platform administrators create organisations; the provisioning rules live in one function. */
export async function createOrganisation(
  d: AdminDependencies,
  context: AdminRequestContext,
  input: CreateOrganisationInput,
): Promise<OrganisationResponse> {
  if (!(await d.isPlatformAdmin(context.actor.id))) throw forbidden()

  const { organisation } = await provisionOrganisation(d, context, {
    name: input.name,
    slug: input.slug,
    roleTemplates: ROLE_TEMPLATES,
  })
  return organisationResponse(organisation)
}
