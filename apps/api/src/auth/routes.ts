import { Elysia, t } from 'elysia'
import type { SessionAccess } from '../identity/access-repository'
import { AppError } from '../shared/errors'
import {
  authenticateBearer,
  readBearerToken,
  type SessionAuthenticator,
  type UserLookup,
} from './bearer'
import type {
  LoginCompletion,
  LoginRequestContext,
  LoginStart,
} from './login-service'
import type { LogoutContext, LogoutResult } from './logout-service'
import type { AuthRateLimit } from './rate-limiter'
import { clientIp, requestContext } from './request-context'
import type { MembershipAccess } from '../identity/access-repository'
import { requestIdOf } from '../shared/request'

export interface LoginFlow {
  start(returnTo: unknown, context: LoginRequestContext): Promise<LoginStart>
  startStepUp(
    userId: string,
    returnTo: unknown,
    context: LoginRequestContext,
  ): Promise<LoginStart>
  complete(
    code: string,
    state: string,
    context: LoginRequestContext,
    sessionToken?: string | null,
  ): Promise<LoginCompletion>
}

export interface AccessReader {
  listForUser(userId: string, at: Date): Promise<SessionAccess>
}

export interface LogoutFlow {
  logout(token: string, context: LogoutContext): Promise<LogoutResult>
}

export interface AuthDependencies {
  readonly login: LoginFlow
  readonly sessions: SessionAuthenticator
  readonly users: UserLookup
  readonly access: AccessReader
  readonly logout: LogoutFlow
  readonly rateLimit?: AuthRateLimit
}

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

const startResponse = (start: LoginStart) => ({
  authorizationUrl: start.authorizationUrl,
  expiresAt: start.expiresAt.toISOString(),
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
export function createAuth(dependencies: AuthDependencies) {
  return new Elysia({
    name: 'auth.routes',
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
        const start = await dependencies.login.start(
          body.returnTo,
          requestContext(request, server, requestIdOf(context)),
        )
        set.status = 201
        return startResponse(start)
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
        const authenticated = await authenticateBearer(
          headers.authorization,
          dependencies.sessions,
          dependencies.users,
        )
        const start = await dependencies.login.startStepUp(
          authenticated.session.userId,
          body.returnTo,
          requestContext(request, server, requestIdOf(context)),
        )
        set.status = 201
        return startResponse(start)
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
        const completion = await dependencies.login.complete(
          body.code,
          body.state,
          requestContext(request, server, requestIdOf(context)),
          readBearerToken(headers.authorization),
        )
        return {
          token: completion.token,
          expiresAt: completion.expiresAt.toISOString(),
          returnTo: completion.returnTo,
        }
      },
    )
    .get(
      '/session',
      {
        response: { 200: sessionResponse },
        detail: routeDetail('Read the current session', true),
      },
      async (context) => {
        const { headers } = context
        const { user } = await authenticateBearer(
          headers.authorization,
          dependencies.sessions,
          dependencies.users,
        )
        const access = await dependencies.access.listForUser(user.id, new Date())
        return {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
          },
          memberships: access.memberships.map(membershipBody),
          permissions: [...access.permissions],
        }
      },
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
          throw new AppError(
            'AUTH_REQUIRED',
            401,
            'Authentication is required.',
          )
        }
        return dependencies.logout.logout(
          token,
          requestContext(request, server, requestIdOf(context)),
        )
      },
    )
}
function membershipBody(membership: MembershipAccess) {
  return {
    id: membership.id,
    organisationId: membership.organisationId,
    organisationName: membership.organisationName,
    hospitalId: membership.hospitalId,
    hospitalName: membership.hospitalName,
    startsAt: membership.startsAt.toISOString(),
    endsAt: membership.endsAt?.toISOString() ?? null,
    roles: [...membership.roles],
  }
}