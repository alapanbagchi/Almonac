import { describe, expect, test } from 'bun:test'
import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../../src/admin/zitadel-management-client'
import type { AuditEvent } from '../../src/audit/audit-writer'
import { EmailVerificationService } from '../../src/auth/email-verification-service'
import type { LoginRequestContext } from '../../src/auth/login-service'
import type { DatabaseQuery } from '../../src/db/pool'
import type {
  ClaimedPendingRegistration,
  PendingRegistrationStore,
} from '../../src/identity/pending-registration-repository'
import { hashToken } from '../../src/shared/tokens'

const context: LoginRequestContext = { ip: null, userAgentHash: null, requestId: 'request-1' }
const token = 'A'.repeat(43)
const now = new Date('2026-11-04T10:00:00.000Z')
const database: DatabaseQuery = { query: async () => ({ rows: [] }) }

function registration(): ClaimedPendingRegistration {
  return {
    id: 'registration-1',
    email: 'ada@example.test',
    displayName: 'Ada Lovelace',
    passwordHash: 'hashed-password',
    expiresAt: new Date(now.getTime() + 60_000),
    claimedAt: now,
    claimId: 'claim-1',
    consumedAt: null,
  }
}

function store(
  claim: PendingRegistrationStore['claim'],
  finish: PendingRegistrationStore['finish'] = async () => true,
  release: PendingRegistrationStore['release'] = async () => true,
): PendingRegistrationStore {
  return { replace: async () => {}, claim, release, finish }
}

describe('email verification service', () => {
  test('creates one verified identity and consumes the pending sign-up', async () => {
    const created: { email: string; displayName: string; passwordHash: string }[] = []
    const consumed: string[] = []
    const audits: AuditEvent[] = []
    const service = new EmailVerificationService(
      store(
        async (_db, tokenHash) =>
          tokenHash.equals(hashToken(token)) ? registration() : null,
        async (_db, id) => {
          consumed.push(id)
          return true
        },
      ),
      {
        createVerifiedHumanUser: async (input) => {
          created.push(input)
          return 'zitadel-user-1'
        },
      },
      {
        write: async (event) => {
          audits.push(event)
        },
      },
      async (run) => run(database),
    )

    const result = await service.verify(token, context)

    expect(result).toEqual({ status: 'verified' })
    expect(created).toEqual([
      {
        email: 'ada@example.test',
        displayName: 'Ada Lovelace',
        passwordHash: 'hashed-password',
      },
    ])
    expect(consumed).toEqual(['registration-1'])
    expect(audits[0]).toMatchObject({
      eventType: 'auth.signup_verified',
      actorType: 'system',
      targetType: 'identity',
      targetId: 'zitadel-user-1',
    })
  })

  test('calls the provider with no database transaction open', async () => {
    let openTransactions = 0
    let providerSawTransaction = true
    const service = new EmailVerificationService(
      store(async () => registration()),
      {
        createVerifiedHumanUser: async () => {
          providerSawTransaction = openTransactions > 0
          return 'zitadel-user-1'
        },
      },
      { write: async () => {} },
      async (run) => {
        openTransactions += 1
        try {
          return await run(database)
        } finally {
          openTransactions -= 1
        }
      },
    )

    await service.verify(token, context)

    expect(providerSawTransaction).toBe(false)
    expect(openTransactions).toBe(0)
  })

  test('rejects a token with the wrong shape before any lookup', async () => {
    let lookups = 0
    const service = new EmailVerificationService(
      store(async () => {
        lookups += 1
        return registration()
      }),
      { createVerifiedHumanUser: async () => 'zitadel-user-1' },
      { write: async () => {} },
      async (run) => run(database),
    )

    await expect(service.verify('short', context)).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_INVALID',
      status: 422,
    })
    await expect(service.verify(undefined, context)).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_INVALID',
      status: 422,
    })
    expect(lookups).toBe(0)
  })

  test('rejects an unknown or expired token without creating an identity', async () => {
    let creates = 0
    const service = new EmailVerificationService(
      store(async () => null),
      {
        createVerifiedHumanUser: async () => {
          creates += 1
          return 'zitadel-user-1'
        },
      },
      { write: async () => {} },
      async (run) => run(database),
    )

    await expect(service.verify(token, context)).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_INVALID',
      status: 422,
    })
    expect(creates).toBe(0)
  })

  test('treats a second click on the same link as invalid', async () => {
    const service = new EmailVerificationService(
      store(async () => null),
      { createVerifiedHumanUser: async () => 'zitadel-user-1' },
      { write: async () => {} },
      async (run) => run(database),
    )

    await expect(service.verify(token, context)).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_INVALID',
      status: 422,
    })
  })

  test('maps a provider conflict to a taken email', async () => {
    let released = false
    const service = new EmailVerificationService(
      store(
        async () => registration(),
        async () => true,
        async () => {
          released = true
          return true
        },
      ),
      {
        createVerifiedHumanUser: async () => {
          throw new ZitadelConflictError()
        },
      },
      { write: async () => {} },
      async (run) => run(database),
    )

    await expect(service.verify(token, context)).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
      status: 409,
    })
    expect(released).toBe(false)
  })

  test('maps a provider rejection to a registration failure', async () => {
    const service = new EmailVerificationService(
      store(async () => registration()),
      {
        createVerifiedHumanUser: async () => {
          throw new ZitadelRejectedError(400, 'password policy')
        },
      },
      { write: async () => {} },
      async (run) => run(database),
    )

    await expect(service.verify(token, context)).rejects.toMatchObject({
      code: 'REGISTRATION_REJECTED',
      status: 422,
    })
  })

  test('releases the claim when the provider is unavailable', async () => {
    const released: string[] = []
    const service = new EmailVerificationService(
      store(
        async () => registration(),
        async () => true,
        async (_db, id) => {
          released.push(id)
          return true
        },
      ),
      {
        createVerifiedHumanUser: async () => {
          throw new ZitadelUnavailableError('timed out')
        },
      },
      { write: async () => {} },
      async (run) => run(database),
    )

    await expect(service.verify(token, context)).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      status: 503,
    })
    expect(released).toEqual(['registration-1'])
  })
})
