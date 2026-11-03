import type { AuditEntry } from './audit-read-repository'
import type { Hospital, HospitalDomain } from './hospital-repository'
import type { Invitation } from './invitation-repository'
import type { MembershipSummary, OrganisationRole } from './membership-admin-repository'
import type { Organisation } from './organisation-repository'

const iso = (value: Date | null): string | null => value?.toISOString() ?? null

export function organisationResponse(value: Organisation) {
  return {
    id: value.id,
    zitadelOrgId: value.zitadelOrgId,
    name: value.name,
    slug: value.slug,
    status: value.status,
    provisionedAt: iso(value.provisionedAt),
    createdAt: value.createdAt.toISOString(),
  }
}

export function hospitalResponse(value: Hospital) {
  return {
    id: value.id,
    organisationId: value.organisationId,
    name: value.name,
    slug: value.slug,
    timezone: value.timezone,
    status: value.status,
    primaryDomainId: value.primaryDomainId,
    createdAt: value.createdAt.toISOString(),
  }
}

export function domainResponse(value: HospitalDomain) {
  return {
    id: value.id,
    hospitalId: value.hospitalId,
    domain: value.domain,
    verifiedAt: iso(value.verifiedAt),
    retiredAt: iso(value.retiredAt),
    createdAt: value.createdAt.toISOString(),
  }
}

export function membershipResponse(value: MembershipSummary) {
  return {
    ...value,
    acceptedAt: value.acceptedAt.toISOString(),
    endsAt: iso(value.endsAt),
    roles: [...value.roles],
  }
}

export function roleResponse(value: OrganisationRole) {
  return { ...value, permissions: [...value.permissions] }
}

export function invitationResponse(value: Invitation) {
  return {
    ...value,
    expiresAt: value.expiresAt.toISOString(),
    createdAt: value.createdAt.toISOString(),
    acceptedAt: iso(value.acceptedAt),
    roleIds: [...value.roleIds],
  }
}

export function auditResponse(value: AuditEntry) {
  return { ...value, occurredAt: value.occurredAt.toISOString() }
}
