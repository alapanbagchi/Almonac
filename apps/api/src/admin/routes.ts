import { Elysia } from 'elysia'
import type { AdminDependencies } from './admin-context'
import { adminContext } from './admin-context'
import { auditRoutes } from './audit-routes'
import { hospitalRoutes } from './hospital-routes'
import { invitationRoutes } from './invitation-routes'
import { membershipRoutes } from './membership-routes'
import { organisationRoutes } from './organisation-routes'
import { authenticateBearer } from '../auth/bearer'
import { requestIdOf } from '../shared/request'

/**
 * Organisation, hospital, membership, invitation and audit administration.
 * Every handler resolves a bearer session and re-checks permission in the
 * service; the browser's session response is never an authorisation source.
 */
export function createAdmin(dependencies: AdminDependencies) {
  return new Elysia({ name: 'admin.routes', prefix: '/v1/admin', tags: ['Administration'] })
    .derive(async (context) => ({
      adminContext: adminContext(
        await authenticateBearer(
          context.headers.authorization,
          dependencies.sessions,
          dependencies.users,
        ),
        context.request,
        context.server as { requestIP?: (request: Request) => { address?: string } | null } | null,
        requestIdOf(context),
      ),
    }))
    .use(organisationRoutes(dependencies))
    .use(hospitalRoutes(dependencies))
    .use(membershipRoutes(dependencies))
    .use(invitationRoutes(dependencies))
    .use(auditRoutes(dependencies))
}
