import type { AppUser } from '../identity/app-user-repository'
import type { AuditAdmin } from './audit/service'
import type { HospitalAdminService } from './hospital-admin-service'
import type { InvitationService } from './invitation-service'
import type { MembershipAdminService } from './membership-admin-service'
import type { OrganisationAdminService } from './organisation-admin-service'
import type { AuthenticatedRequest, SessionAuthenticator, UserLookup } from '../auth/bearer'
import { requestContext, type RequestServer } from '../auth/request-context'

export interface AdminRequestContext {
  readonly actor: AppUser
  readonly sessionId: string
  readonly requestId: string
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

/** What every admin handler needs from the request; the rest stays in Elysia. */
export interface AdminHandlerContext {
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  adminContext?: AdminRequestContext
  set: { status?: number | string }
}

/** Keeps a route group's Elysia type: the handlers are already unannotated. */
export function routeGroup<T>(routes: T): T {
  return routes
}

/** The bearer session resolved by the parent router. */
export function adminContextOf(context: AdminHandlerContext): AdminRequestContext {
  if (context.adminContext === undefined) throw new Error('admin context is not resolved')
  return context.adminContext
}

export interface AdminDependencies {
  readonly organisations: OrganisationAdminService
  readonly hospitals: HospitalAdminService
  readonly memberships: MembershipAdminService
  readonly invitations: InvitationService
  readonly audit: AuditAdmin
  readonly sessions: SessionAuthenticator
  readonly users: UserLookup
}

export function adminContext(
  authenticated: AuthenticatedRequest,
  request: Request,
  server: RequestServer | null | undefined,
  requestId: string,
): AdminRequestContext {
  const base = requestContext(request, server, requestId)
  return {
    actor: authenticated.user,
    sessionId: authenticated.session.id,
    requestId,
    ip: base.ip,
    userAgentHash: base.userAgentHash,
  }
}
