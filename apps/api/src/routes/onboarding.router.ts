import { Elysia, t } from 'elysia'
import { authenticateBearer, type SessionAuthenticator, type UserLookup } from '../guards/bearer'
import { adminContext, type AdminRequestContext } from '../guards/admin-context'
import { requestIdOf, type RequestServer } from '../shared/request'
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
    .derive(async (context) => ({
      onboardingContext: adminContext(
        await authenticateBearer(
          context.headers.authorization,
          dependencies.sessions,
          dependencies.users,
        ),
        context.request,
        context.server as RequestServer | null,
        requestIdOf(context),
      ),
    }))
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
          onboardingContextOf(context),
          context.body,
        )
        context.set.status = 201
        return created
      },
    )
}

function onboardingContextOf(context: {
  onboardingContext?: AdminRequestContext
}): AdminRequestContext {
  if (context.onboardingContext === undefined) throw new Error('onboarding context is not resolved')
  return context.onboardingContext
}
