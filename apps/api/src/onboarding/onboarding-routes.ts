import { Elysia, t } from 'elysia'
import {
  authenticateBearer,
  type SessionAuthenticator,
  type UserLookup,
} from '../auth/bearer'
import { requestContext, requestIdOf } from '../auth/request-context'
import type { OnboardingService } from './onboarding-service'

export interface OnboardingRouteDependencies {
  readonly onboarding: OnboardingService
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
 * A signed-in user with no membership creates one organisation. The service
 * checks that the caller has no active membership; tenant selection does not
 * exist yet, so this route takes no hospital.
 */
export function createOnboarding(dependencies: OnboardingRouteDependencies) {
  return new Elysia({
    name: 'onboarding.routes',
    prefix: '/v1/onboarding',
    tags: ['Onboarding'],
  })
    .onRequest(({ set }) => {
      set.headers['cache-control'] = 'no-store'
      set.headers['referrer-policy'] = 'no-referrer'
    })
    .post('/organisation', {
      body,
      response: { 201: response },
      detail: {
        summary: 'Create the first organisation',
        security: [{ bearerAuth: [] }],
      },
    }, async (context) => {
      const { body: input, headers, request, server, set } = context
      const authenticated = await authenticateBearer(
        headers.authorization,
        dependencies.sessions,
        dependencies.users,
      )
      const created = await dependencies.onboarding.create(
        {
          userId: authenticated.user.id,
          sessionId: authenticated.session.id,
          ...requestContext(request, server, requestIdOf(context)),
        },
        input,
      )
      set.status = 201
      return {
        id: created.id,
        name: created.name,
        slug: created.slug,
        status: created.status,
      }
    })
}
