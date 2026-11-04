import { describe, expect, test } from 'bun:test'
import { RegistrationService, VERIFICATION_TTL_MS } from '../../src/auth/registration-service'
import type { AuditEvent } from '../../src/audit/audit-writer'
import type { AppUser } from '../../src/identity/app-user-repository'
import type { LoginRequestContext } from '../../src/auth/login-service'
import type {
  NewPendingRegistration,
  PendingRegistrationStore,
} from '../../src/identity/pending-registration-repository'
import { hashToken } from '../../src/shared/tokens'

const context: LoginRequestContext = { ip: null, userAgentHash: null, requestId: 'request-1' }
const now = new Date('2026-11-04T10:00:00.000Z')

function existingUser(email: string): AppUser {
  return {
    id: 'user-1',
    identityIssuer: 'https://id.example',
    zitadelSubject: 'subject-1',
    email,
    emailVerifiedAt: null,
    displayName: 'Existing User',
    homeOrganisationId: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  }
}

function store(captured: NewPendingRegistration[]): PendingRegistrationStore {
  return {
    replace: async (input) => {
      captured.push(input)
    },
    claim: async () => null,
    release: async () => true,
    finish: async () => true,
  }
}

describe('registration service', () => {
  test('holds the sign-up until the email is verified', async () => {
    const pending: NewPendingRegistration[] = []
    const mails: { to: string; token: string; expiresAt: Date }[] = []
    const audits: AuditEvent[] = []
    const service = new RegistrationService(
      { findByEmail: async () => null },
      store(pending),
      {
        send: async (input) => {
          mails.push(input)
        },
      },
      {
        write: async (event) => {
          audits.push(event)
        },
      },
      { hash: async () => 'hashed-password' },
      () => now,
    )

    const result = await service.register(
      { fullName: '  Ada   Lovelace ', email: 'Ada@Example.test', password: 'Correct1!' },
      context,
    )

    const stored = pending[0]
    const mail = mails[0]
    if (!stored || !mail) throw new Error('registration was not stored')

    expect(result).toEqual({ status: 'verification_sent' })
    expect(pending).toHaveLength(1)
    expect(stored).toMatchObject({
      email: 'ada@example.test',
      displayName: 'Ada Lovelace',
      passwordHash: 'hashed-password',
      expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
    })
    expect(mails).toHaveLength(1)
    expect(mail.to).toBe('ada@example.test')
    expect(mail.expiresAt).toEqual(stored.expiresAt)
    expect(stored.tokenHash).toEqual(hashToken(mail.token))
    expect(audits[0]).toMatchObject({
      eventType: 'auth.signup_requested',
      actorType: 'system',
      targetType: 'identity',
    })
  })

  test('rejects a taken email before storing anything', async () => {
    const pending: NewPendingRegistration[] = []
    let hashes = 0
    const service = new RegistrationService(
      { findByEmail: async (email) => existingUser(email) },
      store(pending),
      { send: async () => {} },
      { write: async () => {} },
      {
        hash: async () => {
          hashes += 1
          return 'hashed-password'
        },
      },
    )

    await expect(
      service.register(
        { fullName: 'Ada Lovelace', email: 'ada@example.test', password: 'Correct1!' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 })
    expect(pending).toHaveLength(0)
    expect(hashes).toBe(0)
  })

  test('rejects a weak password before any lookup', async () => {
    let lookups = 0
    const service = new RegistrationService(
      {
        findByEmail: async () => {
          lookups += 1
          return null
        },
      },
      store([]),
      { send: async () => {} },
      { write: async () => {} },
      { hash: async () => 'hashed-password' },
    )

    await expect(
      service.register(
        { fullName: 'Ada Lovelace', email: 'ada@example.test', password: 'short' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD', status: 422 })
    expect(lookups).toBe(0)
  })

  test('reports a mail outage without confirming the address exists', async () => {
    const service = new RegistrationService(
      { findByEmail: async () => null },
      store([]),
      {
        send: async () => {
          throw new Error('smtp down')
        },
      },
      { write: async () => {} },
      { hash: async () => 'hashed-password' },
    )

    await expect(
      service.register(
        { fullName: 'Ada Lovelace', email: 'ada@example.test', password: 'Correct1!' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE', status: 503 })
  })
})
