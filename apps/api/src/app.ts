import { Elysia } from 'elysia'
import type { AdminDependencies } from './controllers/admin/dependencies'
import type { AuthDependencies } from './controllers/auth/dependencies'
import type { InvitationDependencies } from './controllers/admin/invitations/issue'
import type { BreakGlassRouterDependencies } from './routes/break-glass.router'
import type { OnboardingRouterDependencies } from './routes/onboarding.router'
import { auditRouter } from './routes/audit.router'
import { authRouter } from './routes/auth.router'
import { breakGlassRouter } from './routes/break-glass.router'
import { healthRouter } from './routes/health.router'
import { hospitalsRouter } from './routes/hospitals.router'
import { invitationsRouter } from './routes/invitations.router'
import { membershipsRouter } from './routes/memberships.router'
import { onboardingRouter } from './routes/onboarding.router'
import { organisationsRouter } from './routes/organisations.router'
import { rolesRouter } from './routes/roles.router'
import { selfServiceRouter } from './routes/self-service.router'
import { errors } from './plugins/errors'
import { docs } from './plugins/openapi'
import { security } from './plugins/security'

export interface AppDependencies {
  readonly checkDatabase: () => Promise<void>
  readonly readinessTimeoutMs?: number
  readonly auth?: AuthDependencies
  readonly onboarding?: OnboardingRouterDependencies
  readonly admin?: AdminDependencies
  readonly invitations?: InvitationDependencies
  readonly breakGlass?: BreakGlassRouterDependencies
  readonly serve?: { readonly maxRequestBodySize?: number }
}

/**
 * Composition root. Tests build an app with a fake database check; index.ts
 * builds the real one and opens the port. Feature routes exist only when their
 * dependencies are supplied.
 */
export function createApp({
  checkDatabase,
  readinessTimeoutMs,
  auth,
  onboarding,
  admin,
  invitations,
  breakGlass,
  serve,
}: AppDependencies) {
  const app = new Elysia({ name: 'almonac.api', ...(serve === undefined ? {} : { serve }) })
    .use(errors)
    .use(security)
    .use(docs)
    .use(
      healthRouter({
        checkDatabase,
        ...(readinessTimeoutMs === undefined ? {} : { timeoutMs: readinessTimeoutMs }),
      }),
    )

  // Each plugin keeps its own instance type, so the mounts stay chained rather
  // than collected in a list.
  const withAuth =
    auth === undefined ? app : app.use(authRouter(auth)).use(selfServiceRouter(auth))
  const withOnboarding =
    onboarding === undefined ? withAuth : withAuth.use(onboardingRouter(onboarding))
  const withAdmin = admin === undefined ? withOnboarding : withOnboarding.use(adminRouters(admin))
  const withInvitations =
    invitations === undefined ? withAdmin : withAdmin.use(invitationsRouter(invitations))
  return breakGlass === undefined
    ? withInvitations
    : withInvitations.use(breakGlassRouter(breakGlass))
}

function adminRouters(dependencies: AdminDependencies) {
  return new Elysia({ name: 'admin.routers' })
    .use(organisationsRouter(dependencies))
    .use(hospitalsRouter(dependencies))
    .use(membershipsRouter(dependencies))
    .use(rolesRouter(dependencies))
    .use(auditRouter(dependencies))
}

export type App = ReturnType<typeof createApp>
