import { describe, expect, test } from 'bun:test'
import { PasswordLoginService, type LoginFlow } from '../../src/auth/password-login-service'
import {
  MfaRequiredError,
  type LoginClient,
  type SessionCredentials,
} from '../../src/auth/zitadel-session-client'
import { ZitadelRejectedError } from '../../src/adapters/zitadel/client'
import type { LoginRequestContext } from '../../src/auth/login-service'

const STATE = 'a'.repeat(43)
const context: LoginRequestContext = { ip: null, userAgentHash: null, requestId: 'request-1' }

function login(recorded: string[]): LoginFlow {
  return {
    start: async () => ({
      authorizationUrl: `https://id.example/authorize?state=${STATE}`,
      expiresAt: new Date(Date.now() + 600_000),
    }),
    recordFailure: async (reasonCode) => {
      recorded.push(reasonCode)
    },
  }
}

function client(overrides: Partial<LoginClient> = {}): LoginClient {
  const session: SessionCredentials = { sessionId: 'session-1', sessionToken: 'token-1' }
  return {
    start: async () => 'V2_authrequest',
    signIn: async () => session,
    complete: async () => `https://app.example/api/auth/callback?code=code-1&state=${STATE}`,
    ...overrides,
  }
}

describe('password login service', () => {
  test('returns the provider callback for a valid password', async () => {
    const recorded: string[] = []
    const service = new PasswordLoginService(login(recorded), client())

    const result = await service.start('Doctor@Example.test', 'correct horse battery', '/dashboard', context)

    expect(result.callbackUrl).toContain('code=code-1')
    expect(recorded).toEqual([])
  })

  test('rejects a malformed address without touching the provider', async () => {
    const recorded: string[] = []
    const service = new PasswordLoginService(login(recorded), client())

    await expect(service.start('not-an-email', 'secret', '/', context)).rejects.toMatchObject({
      code: 'INVALID_EMAIL',
      status: 422,
    })
    expect(recorded).toEqual([])
  })

  test('maps a required second factor and records the reason', async () => {
    const recorded: string[] = []
    const service = new PasswordLoginService(
      login(recorded),
      client({
        signIn: async () => {
          throw new MfaRequiredError()
        },
      }),
    )

    await expect(service.start('doctor@example.test', 'secret', '/', context)).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
      status: 403,
    })
    expect(recorded).toEqual(['mfa_required'])
  })

  test('maps rejected credentials to one generic failure', async () => {
    const recorded: string[] = []
    const service = new PasswordLoginService(
      login(recorded),
      client({
        signIn: async () => {
          throw new ZitadelRejectedError(400, 'AUTH-1')
        },
      }),
    )

    await expect(service.start('doctor@example.test', 'wrong', '/', context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    expect(recorded).toEqual(['invalid_credentials'])
  })

  test('rejects a callback whose state does not match the attempt', async () => {
    const recorded: string[] = []
    const service = new PasswordLoginService(
      login(recorded),
      client({
        complete: async () => 'https://app.example/api/auth/callback?code=code-1&state=' + 'b'.repeat(43),
      }),
    )

    await expect(service.start('doctor@example.test', 'secret', '/', context)).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      status: 503,
    })
    expect(recorded).toEqual(['invalid_authorization'])
  })
})
