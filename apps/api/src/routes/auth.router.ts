import { Elysia, t } from 'elysia'
import { AppError } from '../shared/errors'
import { readBearerToken } from '../guards/bearer'
import { clientIp, requestContext, requestIdOf } from '../shared/request'
import type { AuthDependencies } from '../controllers/auth/dependencies'
import { completeCallback } from '../controllers/auth/complete-callback'
import { logout } from '../controllers/auth/logout'
import { readSession } from '../controllers/auth/read-session'
import { startLogin } from '../controllers/auth/start-login'
import { startStepUp } from '../controllers/auth/start-step-up'
import { authenticateRequest } from '../controllers/auth/session'

const loginAttemptBody = t.Object({
  returnTo: t.Optional(t.String({ maxLength: 2_048 })),
})

const loginStartResponse = t.Object({
  authorizationUrl: t.String(),
  expiresAt: t.String(),
})

const callbackBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 4_096 }),
  state: t.String({ minLength: 43, maxLength: 43 }),
})

const callbackResponse = t.Object({
  token: t.String(),
  expiresAt: t.String(),
  returnTo: t.String(),
})

const membershipSchema = t.Object({
  id: t.String(),
  organisationId: t.String(),
  organisationName: t.String(),
  hospitalId: t.Union([t.String(), t.Null()]),
  hospitalName: t.Union([t.String(), t.Null()]),
  startsAt: t.String(),
  endsAt: t.Union([t.String(), t.Null()]),
  roles: t.Array(t.String()),
})

const sessionResponse = t.Object({
  user: t.Object({
    id: t.String(),
    email: t.String(),
    displayName: t.String(),
  }),
  memberships: t.Array(membershipSchema),
  permissions: t.Array(t.String()),
})

const logoutResponse = t.Object({
  endSessionUrl: t.Union([t.String(), t.Null()]),
})

const routeDetail = (summary: string, authenticated = false) => ({
  summary,
  tags: ['Authentication'],
  ...(authenticated ? { security: [{ bearerAuth: [] }] } : {}),
})

/**
 * API-owned OIDC and session routes. The browser talks to the Next.js BFF;
 * this API accepts an authorization code, a bearer token and an internal path,
 * never a cookie.
 */
export function authRouter(dependencies: AuthDependencies) {
  return new Elysia({
    name: 'auth.router',
    prefix: '/v1/auth',
    tags: ['Authentication'],
  })
    .post(
      '/login-attempts',
      {
        body: loginAttemptBody,
        response: { 201: loginStartResponse },
        detail: routeDetail('Start a login attempt'),
      },
      async (context) => {
        const { body, request, server, set } = context
        await dependencies.rateLimit?.check('login', clientIp(request, server))
        set.status = 201
        return startLogin(
          dependencies,
          requestContext(request, server, requestIdOf(context)),
          body.returnTo,
        )
      },
    )
    .post(
      '/step-up-attempts',
      {
        body: loginAttemptBody,
        response: { 201: loginStartResponse },
        detail: routeDetail('Start a step-up attempt', true),
      },
      async (context) => {
        const { body, headers, request, server, set } = context
        await dependencies.rateLimit?.check('step_up', clientIp(request, server))
        const authenticated = await authenticateRequest(dependencies, headers.authorization)
        set.status = 201
        return startStepUp(
          dependencies,
          requestContext(request, server, requestIdOf(context)),
          authenticated.session.userId,
          body.returnTo,
        )
      },
    )
    .post(
      '/callback',
      {
        body: callbackBody,
        response: { 200: callbackResponse },
        detail: routeDetail('Complete a login or step-up attempt'),
      },
      async (context) => {
        const { body, headers, request, server } = context
        await dependencies.rateLimit?.check('callback', clientIp(request, server))
        return completeCallback(dependencies, requestContext(request, server, requestIdOf(context)), {
          code: body.code,
          state: body.state,
          sessionToken: readBearerToken(headers.authorization),
        })
      },
    )
    .get(
      '/session',
      {
        response: { 200: sessionResponse },
        detail: routeDetail('Read the current session', true),
      },
      async (context) => readSession(dependencies, context.headers.authorization),
    )
    .post(
      '/logout',
      {
        response: { 200: logoutResponse },
        detail: routeDetail('Revoke the current session', true),
      },
      async (context) => {
        const { headers, request, server } = context
        const token = readBearerToken(headers.authorization)
        if (token === null) {
          throw new AppError('AUTH_REQUIRED', 401, 'Authentication is required.')
        }
        return logout(
          dependencies,
          token,
          requestContext(request, server, requestIdOf(context)),
        )
      },
    )
}
