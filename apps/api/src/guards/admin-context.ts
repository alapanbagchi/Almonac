import { Elysia } from 'elysia'
import type { AppUser } from '../repositories/app-user-repository'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import { authenticateBearer, type AuthenticatedRequest, type SessionAuthenticator, type UserLookup } from './bearer'
import { requestContext, requestIdOf, type RequestServer } from '../shared/request'

export interface AdminRequestContext {
  readonly actor: AppUser
  readonly sessionId: string
  readonly requestId: string
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

/** The bearer session resolved by the guard below. */
export function adminContextOf(context: { adminContext?: AdminRequestContext }): AdminRequestContext {
  if (context.adminContext === undefined) throw new Error('admin context is not resolved')
  return context.adminContext
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

/**
 * Authenticate once per admin route group. Permission is not checked here:
 * three of six slices only know the scope after they load the row, so the
 * decision stays in the controller that can see it.
 *
 * Scope is 'plugin': a locally scoped derive would not reach the routes a
 * consuming router registers after .use(adminGuard(d)), leaving them
 * unauthenticated while still type-checking.
 */
export function adminGuard(d: Pick<AdminDependencies, 'sessions' | 'users'>) {
  return new Elysia({ name: 'guards.admin' }).derive('plugin', async (context) => ({
    adminContext: adminContext(
      await authenticateBearer(context.headers.authorization, d.sessions, d.users),
      context.request,
      context.server as RequestServer | null,
      requestIdOf(context),
    ),
  }))
}

export type { SessionAuthenticator, UserLookup }