import { Elysia, t } from 'elysia'
import type { AuthRateLimit } from './rate-limiter'
import { clientIp, requestContext, requestIdOf } from './request-context'
import type { PasswordLoginService } from './password-login-service'
import type { RegistrationService } from './registration-service'
import type { EmailVerificationService } from './email-verification-service'

export interface SelfServiceDependencies {
  readonly registration: RegistrationService
  readonly verification: EmailVerificationService
  readonly passwordLogin: PasswordLoginService
  readonly rateLimit?: AuthRateLimit
}

const callbackResponse = t.Object({ callbackUrl: t.String() })
const sentResponse = t.Object({ status: t.Literal('verification_sent') })
const verifiedResponse = t.Object({ status: t.Literal('verified') })

const registrationBody = t.Object({
  fullName: t.String({ minLength: 2, maxLength: 200 }),
  email: t.String({ minLength: 3, maxLength: 320 }),
  password: t.String({ minLength: 8, maxLength: 72 }),
})

const verificationBody = t.Object({
  token: t.String({ minLength: 32, maxLength: 128 }),
})

const passwordBody = t.Object({
  email: t.String({ minLength: 3, maxLength: 320 }),
  password: t.String({ minLength: 1, maxLength: 1_024 }),
  returnTo: t.Optional(t.String({ maxLength: 2_048 })),
})

const routeDetail = (summary: string) => ({ summary, tags: ['Authentication'] })

/**
 * First-party credential routes. The browser posts the password to this API,
 * which forwards it to the identity provider. A sign-up returns no session:
 * the provider user is created only after the address is verified.
 */
export function createSelfService(dependencies: SelfServiceDependencies) {
  return new Elysia({
    name: 'auth.self-service',
    prefix: '/v1/auth',
    tags: ['Authentication'],
  })
    .onRequest(({ set }) => {
      set.headers['cache-control'] = 'no-store'
      set.headers['referrer-policy'] = 'no-referrer'
    })
    .post('/register', {
      body: registrationBody,
      response: { 202: sentResponse },
      detail: routeDetail('Request an email verification for a new account'),
    }, async (context) => {
      const { body, request, server, set } = context
      await dependencies.rateLimit?.check('register', clientIp(request, server))
      const result = await dependencies.registration.register(
        body,
        requestContext(request, server, requestIdOf(context)),
      )
      set.status = 202
      return result
    })
    .post('/verify-email', {
      body: verificationBody,
      response: { 200: verifiedResponse },
      detail: routeDetail('Verify an email address and create the account'),
    }, async (context) => {
      const { body, request, server } = context
      await dependencies.rateLimit?.check('verify', clientIp(request, server))
      return dependencies.verification.verify(
        body.token,
        requestContext(request, server, requestIdOf(context)),
      )
    })
    .post('/password-login', {
      body: passwordBody,
      response: { 200: callbackResponse },
      detail: routeDetail('Start a login with an email and password'),
    }, async (context) => {
      const { body, request, server } = context
      await dependencies.rateLimit?.check('password', clientIp(request, server))
      return dependencies.passwordLogin.start(
        body.email,
        body.password,
        body.returnTo,
        requestContext(request, server, requestIdOf(context)),
      )
    })
}
