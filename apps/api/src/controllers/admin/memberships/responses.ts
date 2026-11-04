import type { MembershipSummary } from '../../../repositories/membership-repository'
import type { OrganisationRole } from '../../../repositories/role-repository'
import { instant, maybeInstant } from '../../../shared/instant'

/** Repository values are Dates and readonly arrays; the wire carries ISO strings and arrays. */
export interface MembershipResponse {
  readonly id: string
  readonly userId: string
  readonly email: string
  readonly displayName: string
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly status: MembershipSummary['status']
  readonly acceptedAt: string
  readonly endsAt: string | null
  readonly roles: string[]
}

export interface RoleResponse {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly scope: OrganisationRole['scope']
  readonly permissions: string[]
}

export interface OkResponse {
  readonly ok: true
}

export function membershipResponse(value: MembershipSummary): MembershipResponse {
  return {
    ...value,
    acceptedAt: instant(value.acceptedAt),
    endsAt: maybeInstant(value.endsAt),
    roles: [...value.roles],
  }
}

export function roleResponse(value: OrganisationRole): RoleResponse {
  return { ...value, permissions: [...value.permissions] }
}
