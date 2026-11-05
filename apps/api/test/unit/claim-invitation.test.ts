import { describe, expect, test } from 'bun:test'
import { claimInvitation } from '../../src/controllers/auth/claim-invitation'
import type { AuthDependencies } from '../../src/controllers/auth/dependencies'
import { AppError } from '../../src/shared/errors'
import {
  CONTEXT,
  FakeDatabase,
  NOW,
  RecordingAudit,
  baseDependencies,
  fakePasswords,
  loginAttemptRow,
  userRow,
} from './auth-fixtures'

const TOKEN = 't'.repeat(43)
const INVITATION_ID = '11111111-1111-4111-8111-111111111111'
const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222'

function invitationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INVITATION_ID,
    email: 'person@example.com',
    organisation_id: ORGANISATION_ID,
    hospital_id: null,
    kind: 'new_user',
    zitadel_sub: null,
    status: 'pending',
    expires_at: new Date('2026-11-12T00:00:00.000Z'),
    created_at: NOW,
    accepted_at: null,
    accepted_by_user_id: null,
    invited_by: '33333333-3333-4333-8333-333333333333',
    role_ids: ['44444444-4444-4444-8444-444444444444'],
    ...overrides,
  }
}

function database(invitation: Record<string, unknown> | null, user: unknown = undefined): FakeDatabase {
  return new FakeDatabase([
    { match: /where invitation\.token_hash/, rows: invitation === null ? [] : [invitation] },
    { match: /from identity\.app_user where email/, rows: user === undefined ? [] : [user] },
    { match: /insert into identity\.login_attempt/, rows: loginAttemptRow },
  ])
}

function dependencies(db: FakeDatabase, overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return baseDependencies({ db, clock: () => NOW, ...overrides })
}

function signedInLoginClient() {
  let state = ''
  return {
    async start(authorizationUrl: string) {
      state = new URL(authorizationUrl).searchParams.get('state') ?? ''
      return 'auth-request-1'
    },
    async signIn() {
      return { sessionId: 'sess-1', sessionToken: 'token-1' }
    },
    async complete() {
      return `http://api.test/v1/auth/callback?code=code-1&state=${state}`
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

const INPUT = {
  token: TOKEN,
  fullName: '  Ada   Lovelace ',
  password: 'Correct horse 9!',
}

describe('claiming an invitation', () => {
  test('creates a verified account, audits it and starts password login', async () => {
    const created: { email: string; displayName: string; passwordHash: string }[] = []
    const audit = new RecordingAudit()
    const hashed: string[] = []
    const db = database(invitationRow())

    const result = await claimInvitation(
      dependencies(db, {
        audit,
        identities: {
          async createVerifiedHumanUser(input) {
            created.push(input)
            return 'identity-1'
          },
        },
        passwords: fakePasswords(async (password) => {
          hashed.push(password)
          return 'bcrypt-hash'
        }),
        loginClient: signedInLoginClient(),
      }),
      CONTEXT,
      INPUT,
    )

    expect(result.callbackUrl).toStartWith('http://api.test/v1/auth/callback?')
    expect(created).toEqual([
      { email: 'person@example.com', displayName: 'Ada Lovelace', passwordHash: 'bcrypt-hash' },
    ])
    expect(hashed).toEqual([INPUT.password])
    expect(created[0]?.passwordHash).not.toContain(INPUT.password)

    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({
      actorType: 'system',
      eventType: 'auth.invitation_registered',
      targetType: 'invitation',
      targetId: INVITATION_ID,
      organisationId: ORGANISATION_ID,
      metadata: { invitation_id: INVITATION_ID },
    })
  })

  test('an unknown token is not an existence oracle', async () => {
    const db = database(null)
    const failure = await rejection(claimInvitation(dependencies(db), CONTEXT, INPUT))

    expect(failure).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'Invitation not found.' })
  })

  test('a used invitation is a conflict', async () => {
    const db = database(invitationRow({ status: 'accepted' }))
    const failure = await rejection(claimInvitation(dependencies(db), CONTEXT, INPUT))

    expect(failure).toMatchObject({ code: 'CONFLICT', message: 'Invitation is no longer pending.' })
  })

  test('an expired invitation is a conflict', async () => {
    const db = database(invitationRow({ expires_at: new Date('2026-11-01T00:00:00.000Z') }))
    const failure = await rejection(claimInvitation(dependencies(db), CONTEXT, INPUT))

    expect(failure).toMatchObject({ code: 'CONFLICT', message: 'Invitation has expired.' })
  })

  test('an invitation for an existing identity must be accepted by signing in', async () => {
    const db = database(invitationRow({ kind: 'existing_user', zitadel_sub: 'subject-1' }))
    const failure = await rejection(claimInvitation(dependencies(db), CONTEXT, INPUT))

    expect(failure).toMatchObject({
      code: 'RULE_VIOLATION',
      message: 'This invitation must be accepted by signing in.',
    })
  })

  test('an email that already has an account is a conflict before hashing', async () => {
    let hashes = 0
    const db = database(invitationRow(), userRow({ email: 'person@example.com' }))
    const failure = await rejection(
      claimInvitation(
        dependencies(db, {
          passwords: fakePasswords(async () => {
            hashes += 1
            return 'bcrypt-hash'
          }),
        }),
        CONTEXT,
        INPUT,
      ),
    )

    expect(failure).toMatchObject({
      code: 'CONFLICT',
      message: 'An account already uses this email address.',
    })
    expect(hashes).toBe(0)
  })
})
