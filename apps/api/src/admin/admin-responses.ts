import type { Hospital, HospitalDomain } from './hospital-repository'
import type { Invitation } from './invitation-repository'
import type { MembershipSummary, OrganisationRole } from './membership-admin-repository'
import type { Organisation } from './organisation-repository'
import { instant, maybeInstant } from '../shared/instant'

/**
 * Repository values are Dates and readonly arrays; the response schema says
 * ISO strings and arrays. These mappers state exactly that difference, field by
 * field, so every route answers with the shape its schema promises.
 */
export function organisationResponse(value: Organisation) {
  return { ...value, provisionedAt: maybeInstant(value.provisionedAt), createdAt: instant(value.createdAt) }
}

export function hospitalResponse(value: Hospital) {
  return { ...value, createdAt: instant(value.createdAt) }
}

export function domainResponse(value: HospitalDomain) {
  return {
    ...value,
    verifiedAt: maybeInstant(value.verifiedAt),
    retiredAt: maybeInstant(value.retiredAt),
    createdAt: instant(value.createdAt),
  }
}

export function membershipResponse(value: MembershipSummary) {
  return {
    ...value,
    acceptedAt: instant(value.acceptedAt),
    endsAt: maybeInstant(value.endsAt),
    roles: [...value.roles],
  }
}

export function roleResponse(value: OrganisationRole) {
  return { ...value, permissions: [...value.permissions] }
}

export function invitationResponse(value: Invitation) {
  return {
    ...value,
    expiresAt: instant(value.expiresAt),
    createdAt: instant(value.createdAt),
    acceptedAt: maybeInstant(value.acceptedAt),
    roleIds: [...value.roleIds],
  }
}
