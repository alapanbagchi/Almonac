import type { Organisation, OrganisationStatus } from '../../../repositories/organisation-repository'
import { instant, maybeInstant } from '../../../shared/instant'

export interface OrganisationResponse {
  readonly id: string
  readonly zitadelOrgId: string | null
  readonly name: string
  readonly slug: string
  readonly status: OrganisationStatus
  readonly provisionedAt: string | null
  readonly createdAt: string
}

/** Dates cross the HTTP boundary as ISO instants, never as Date objects. */
export function organisationResponse(organisation: Organisation): OrganisationResponse {
  return {
    id: organisation.id,
    zitadelOrgId: organisation.zitadelOrgId,
    name: organisation.name,
    slug: organisation.slug,
    status: organisation.status,
    provisionedAt: maybeInstant(organisation.provisionedAt),
    createdAt: instant(organisation.createdAt),
  }
}
