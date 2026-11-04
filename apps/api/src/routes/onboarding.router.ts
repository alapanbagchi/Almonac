import { Elysia, t } from 'elysia'
import { adminContextOf, adminGuard } from '../guards/admin-context'
import type { SessionAuthenticator, UserLookup } from '../guards/bearer'
import {
  createOnboarding,
  type OnboardingDependencies,
} from '../controllers/onboarding/create-onboarding'

export interface OnboardingRouterDependencies extends OnboardingDependencies {
  readonly sessions: SessionAuthenticator
  readonly users: UserLookup
}

const body = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  slug: t.String({ minLength: 1, maxLength: 63 }),
})

const response = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  status: t.String(),
})

/**
 * A signed-in user with no membership creates one organisation. The controller
 * checks that the caller has no active membership; tenant selection does not
 * exist yet, so this route takes no hospital.
 */
export function onboardingRouter(dependencies: OnboardingRouterDependencies) {
  return new Elysia({
    name: 'onboarding.routes',
    prefix: '/v1/onboarding',
    tags: ['Onboarding'],
  })
    .use(adminGuard(dependencies))
    .post(
      '/organisation',
      {
        body,
        response: { 201: response },
        detail: {
          summary: 'Create the first organisation',
          security: [{ bearerAuth: [] }],
        },
      },
      async (context) => {
        const created = await createOnboarding(
          dependencies,
          adminContextOf(context),
          context.body,
        )
        context.set.status = 201
        return created
      },
    )
}
