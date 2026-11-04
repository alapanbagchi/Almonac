import { describe, expect, test } from 'bun:test'
import {
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  VERIFICATION_TTL_MS,
  register,
} from '../../src/controllers/auth/register'
import { verifyEmail } from '../../src/controllers/auth/verify-email'
import type { AuthDependencies } from '../../src/controllers/auth/dependencies'
import type { VerificationMailer } from '../../src/controllers/auth/dependencies'
import { AppError } from '../../src/shared/errors'
import { hashToken } from '../../src/shared/tokens'
import {
  CONTEXT,
  FakeDatabase,
  NOW,
  RecordingAudit,
  baseDependencies,
  fakePasswords,
  userRow,
} from './auth-fixtures'

const STRONG = 'Correct horse 9!'

interface Sent {
  to: string
  token: string
  expiresAt: Date
}

function mailer(sent: Sent[], failure?: Error): VerificationMailer {
  return {
    async send(input) {
      if (failure !== undefined) throw failure
      sent.push(input)
    },
  }
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError')
}

function dependencies(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return baseDependencies({ clock: () => NOW, ...overrides })
}

const INPUT = { fullName: '  Ada   Lovelace ', email: ' Ada@Example.Test ', password: STRONG }

describe('registration', () => {
  test('stores a pending registration and sends the verification link', async () => {
    const db = new FakeDatabase()
    const audit = new RecordingAudit()
    const sent: Sent[] = []

    const result = await register(
      dependencies({ db, audit, mailer: mailer(sent) }),
      CONTEXT,
      INPUT,
    )

    expect(result).toEqual({ status: 'verification_sent' })
    expect(sent).toHaveLength(1)
    const message = sent[0]!
    expect(message.to).toBe('ada@example.test')
    expect(message.expiresAt.toISOString()).toBe(
      new Date(NOW.getTime() + VERIFICATION_TTL_MS).toISOString(),
    )

    const [insert] = db.statementsMatching(/insert into identity\.pending_registration/)
    expect(insert).toBeDefined()
    expect(insert?.values).toContain('ada@example.test')
    expect(insert?.values).toContain('Ada Lovelace')
    expect(insert?.values).toContain('bcrypt-hash')
    expect(insert?.values).toContainEqual(hashToken(message.token))
    expect(insert?.values).not.toContain(message.token)

    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]?.eventType).toBe('auth.signup_requested')
    expect(audit.events[0]?.actorType).toBe('system')
    expect(audit.events[0]?.targetType).toBe('identity')
  })

  test('an address already in use is a conflict, before any password work', async () => {
    let hashes = 0
    const db = new FakeDatabase([{ match: /identity\.app_user/, rows: [userRow()] }])
    const failure = await rejection(
      register(
        dependencies({
          db,
          passwords: fakePasswords(async () => {
            hashes += 1
            return 'hash'
          }),
        }),
        CONTEXT,
        INPUT,
      ),
    )

    expect(failure.code).toBe('CONFLICT')
    expect(failure.status).toBe(409)
    expect(hashes).toBe(0)
    expect(db.statementsMatching(/insert into identity\.pending_registration/)).toHaveLength(0)
  })

  test('a weak password is refused before the email lookup', async () => {
    const db = new FakeDatabase()
    const failures = ['short1!', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoDigits!!', 'NoSymbol123']

    for (const password of failures) {
      const failure = await rejection(
        register(dependencies({ db }), CONTEXT, { ...INPUT, password }),
      )
      expect(failure.code).toBe('INVALID_PASSWORD')
      expect(failure.status).toBe(422)
    }
    expect(db.statements).toHaveLength(0)
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })

  test('rejects an invalid email and an out-of-range name', async () => {
    const invalidEmail = await rejection(
      register(dependencies(), CONTEXT, { ...INPUT, email: 'not-an-email' }),
    )
    expect(invalidEmail.code).toBe('INVALID_EMAIL')

    const shortName = await rejection(
      register(dependencies(), CONTEXT, { ...INPUT, fullName: 'A' }),
    )
    expect(shortName.code).toBe('INVALID_NAME')

    const longName = await rejection(
      register(dependencies(), CONTEXT, { ...INPUT, fullName: 'a'.repeat(MAX_NAME_LENGTH + 1) }),
    )
    expect(longName.code).toBe('INVALID_NAME')
  })

  test('a mail outage is reported without promising a delivery', async () => {
    const failure = await rejection(
      register(
        dependencies({ mailer: mailer([], new Error('smtp down')) }),
        CONTEXT,
        INPUT,
      ),
    )

    expect(failure.code).toBe('MAIL_UNAVAILABLE')
    expect(failure.status).toBe(503)
  })
})

describe('email verification', () => {
  test('a malformed token is refused before any lookup', async () => {
    let transactions = 0
    const dependenciesUnderTest = dependencies({
      transaction: async (run) => {
        transactions += 1
        return run(new FakeDatabase())
      },
    })

    for (const token of ['short', 'x'.repeat(44), '', undefined, 42]) {
      const failure = await rejection(verifyEmail(dependenciesUnderTest, CONTEXT, token))
      expect(failure.code).toBe('EMAIL_VERIFICATION_INVALID')
      expect(failure.status).toBe(422)
    }
    expect(transactions).toBe(0)
  })
})
