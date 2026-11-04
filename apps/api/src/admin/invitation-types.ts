import type { Pool } from 'pg'
import type { AuditSink } from '../audit/audit-writer'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { AppUserRepository } from '../identity/app-user-repository'
import type { HospitalRepository } from './hospital-repository'
import type { InvitationRepository } from './invitation-repository'
import type { MembershipAdminRepository } from './membership-admin-repository'
import type { OrganisationRepository } from './organisation-repository'
import type { ZitadelManagementClient } from '../adapters/zitadel/client'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Where an invitation points: the names the mail names, nothing else. */
export interface InvitationDelivery {
  readonly organisationName: string
  readonly hospitalName: string | null
}

export interface InvitationMailer {
  send(input: {
    to: string
    token: string
    organisationName: string
    hospitalName: string | null
    expiresAt: Date
  }): Promise<void>
}

export interface InvitationServiceDependencies {
  readonly pool: Pool
  readonly invitations: InvitationRepository
  readonly organisations: OrganisationRepository
  readonly hospitals: HospitalRepository
  readonly memberships: MembershipAdminRepository
  readonly users: AppUserRepository
  readonly authorization: AuthorizationRepository
  readonly zitadel: ZitadelManagementClient
  readonly mailer: InvitationMailer
  readonly audit: AuditSink
  readonly clock?: () => Date
}
