import { Elysia } from 'elysia'
import type { AdminDependencies } from './admin/admin-context'
import { createAdmin } from './admin/routes'
import type { AuthDependencies } from './auth/routes'
import { createAuth } from './auth/routes'
import type { SelfServiceDependencies } from './auth/self-service-routes'
import { createSelfService } from './auth/self-service-routes'
import type { BreakGlassDependencies } from './break-glass/break-glass-routes'
import { createBreakGlass } from './break-glass/break-glass-routes'
import { createHealth, type ReadinessCheck } from './health'
import type { OnboardingRouteDependencies } from './onboarding/onboarding-routes'
import { createOnboarding } from './onboarding/onboarding-routes'
import { errors } from './plugins/errors'
import { docs } from './plugins/openapi'
import { security } from './plugins/security'

export interface AppDependencies {
  readonly checkDatabase: ReadinessCheck
  readonly readinessTimeoutMs?: number
  readonly auth?: AuthDependencies
  readonly selfService?: SelfServiceDependencies
  readonly onboarding?: OnboardingRouteDependencies
  readonly admin?: AdminDependencies
  readonly breakGlass?: BreakGlassDependencies
  readonly serve?: { readonly maxRequestBodySize?: number }
}

/**
 * Composition root. Tests build an app with a fake database check; index.ts
 * builds the real one and opens the port. Authentication routes exist only
 * when their dependencies are supplied.
 */
export function createApp({
  checkDatabase,
  readinessTimeoutMs,
  auth,
  selfService,
  onboarding,
  admin,
  breakGlass,
  serve,
}: AppDependencies) {
  const app = new Elysia({ name: 'almonac.api', ...(serve === undefined ? {} : { serve }) })
    .use(errors)
    .use(security)
    .use(docs)
    .use(createHealth(checkDatabase, readinessTimeoutMs))

  // Feature routes are mounted only when their dependencies are supplied, so
  // tests can build an app with a subset. Each plugin keeps its own instance
  // type, so the mounts stay chained rather than collected in a list.
  const withAuth = auth === undefined ? app : app.use(createAuth(auth))
  const withSelfService =
    selfService === undefined ? withAuth : withAuth.use(createSelfService(selfService))
  const withOnboarding =
    onboarding === undefined ? withSelfService : withSelfService.use(createOnboarding(onboarding))
  const withAdmin = admin === undefined ? withOnboarding : withOnboarding.use(createAdmin(admin))
  return breakGlass === undefined ? withAdmin : withAdmin.use(createBreakGlass(breakGlass))
}

export type App = ReturnType<typeof createApp>
