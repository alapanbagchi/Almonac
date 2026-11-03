import { describe, expect, test } from 'bun:test'
import { hashToken, isSessionToken } from '../../src/shared/tokens'
import type { NewWebSession, WebSession } from '../../src/identity/session-repository'
import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
  SessionService,
  type SessionStore,
} from '../../src/identity/session-service'

const START = new Date('2026-01-01T10:00:00.000Z')

type MutableSession = { -readonly [Key in keyof WebSession]: WebSession[Key] }

class FakeStore implements SessionStore {
  readonly rows: MutableSession[] = []
  readonly touches: Array<{ id: string; at: Date }> = []
  readonly revocations: Array<{ id: string; at: Date; reason: string }> = []
  failCreate = false

  async create(input: NewWebSession): Promise<WebSession> {
    if (this.failCreate) throw new Error('insert failed')

    const at = START
    const row: MutableSession = {
      id: `session-${this.rows.length + 1}`,
      userId: input.userId,
      identityIssuer: input.identityIssuer,
      tokenHash: input.tokenHash,
      zitadelSessionId: input.zitadelSessionId,
      oidcSid: input.oidcSid,
      acr: input.acr,
      idTokenHintCiphertext: input.idTokenHintCiphertext,
      keyVersion: input.keyVersion,
      amr: [...input.amr],
      authTime: input.authTime,
      aal: input.aal,
      createdAt: at,
      lastSeenAt: at,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      revokedAt: null,
      revokeReason: null,
      ip: input.ip,
      userAgentHash: input.userAgentHash,
    }
    this.rows.push(row)
    return row
  }

  async findByTokenHash(tokenHash: Buffer): Promise<WebSession | null> {
    return this.rows.find((row) => row.tokenHash.equals(tokenHash)) ?? null
  }

  async touch(id: string, at: Date, idleExpiresAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row === undefined || row.revokedAt !== null) return false
    row.lastSeenAt = at
    row.idleExpiresAt = idleExpiresAt
    this.touches.push({ id, at })
    return true
  }

  async revoke(id: string, at: Date, reason: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row === undefined || row.revokedAt !== null) return false
    row.revokedAt = at
    row.revokeReason = reason
    this.revocations.push({ id, at, reason })
    return true
  }
}

function service(store: FakeStore, clock: () => Date): SessionService {
  return new SessionService({ store, clock })
}

function changes(store: FakeStore, index = 0): WebSession {
  return store.rows[index]!
}

describe('session service', () => {
  test('mint a random token and store only its hash', async () => {
    const store = new FakeStore()
    const sessions = service(store, () => START)

    const issued = await sessions.mint({
      userId: 'user-1',
      identityIssuer: 'http://localhost:8080',
      zitadelSessionId: 'zitadel-session',
      oidcSid: 'sid',
      acr: 'urn:zitadel:iam:org:project:id:test:aud',
      idTokenHintCiphertext: Buffer.from('sealed'),
      keyVersion: 1,
      amr: ['pwd'],
      authTime: new Date(START.getTime() - 1_000),
      aal: 1,
      ip: '127.0.0.1',
      userAgentHash: Buffer.alloc(32, 1),
    })

    expect(isSessionToken(issued.token)).toBe(true)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]!.tokenHash).toEqual(hashToken(issued.token))
    expect(store.rows[0]!.tokenHash).not.toEqual(Buffer.from(issued.token))
    expect(issued.expiresAt).toEqual(
      new Date(START.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS),
    )
    expect(changes(store).absoluteExpiresAt).toEqual(
      new Date(START.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS),
    )
  })

  test('reject an unpaired sealed hint and key version', async () => {
    const sessions = service(new FakeStore(), () => START)
    await expect(
      sessions.mint({
        userId: 'user-1',
        identityIssuer: 'http://localhost:8080',
        zitadelSessionId: null,
        oidcSid: null,
        acr: null,
        idTokenHintCiphertext: Buffer.from('sealed'),
        keyVersion: null,
        amr: ['pwd'],
        authTime: START,
        aal: 1,
        ip: null,
        userAgentHash: null,
      }),
    ).rejects.toThrow('must be paired')
  })

  test('authenticate touches at most once per interval', async () => {
    let now = START
    const store = new FakeStore()
    const sessions = service(store, () => now)
    const issued = await sessions.mint(input())

    expect((await sessions.authenticate(issued.token))?.id).toBe('session-1')
    expect(store.touches).toHaveLength(0)

    now = new Date(START.getTime() + SESSION_TOUCH_INTERVAL_MS)
    expect((await sessions.authenticate(issued.token))?.id).toBe('session-1')
    expect(store.touches).toHaveLength(1)
    expect(store.touches[0]!.at).toEqual(now)

    now = new Date(START.getTime() + SESSION_TOUCH_INTERVAL_MS + 1)
    await sessions.authenticate(issued.token)
    expect(store.touches).toHaveLength(1)
  })

  test('reject malformed, unknown, revoked, idle-expired and absolute-expired tokens', async () => {
    let now = START
    const store = new FakeStore()
    const sessions = service(store, () => now)
    const issued = await sessions.mint(input())

    expect(await sessions.authenticate('')).toBeNull()
    expect(await sessions.authenticate('A'.repeat(43))).toBeNull()

    now = new Date(START.getTime() + SESSION_IDLE_TIMEOUT_MS)
    expect(await sessions.authenticate(issued.token)).toBeNull()

    now = START
    await store.revoke('session-1', now, 'logout')
    expect(await sessions.authenticate(issued.token)).toBeNull()

    const second = await sessions.mint(input())
    now = new Date(START.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS)
    expect(await sessions.authenticate(second.token)).toBeNull()
  })

  test('rotate revokes the old token and keeps the absolute expiry', async () => {
    let now = START
    const store = new FakeStore()
    const sessions = service(store, () => now)
    const issued = await sessions.mint(input())
    const absolute = changes(store).absoluteExpiresAt

    now = new Date(START.getTime() + 5 * 60 * 1_000)
    const rotated = await sessions.rotate(issued.token, {
      amr: ['pwd', 'mfa'],
      authTime: now,
      aal: 2,
    })

    expect(rotated).not.toBeNull()
    expect(rotated!.token).not.toBe(issued.token)
    expect(await sessions.authenticate(issued.token)).toBeNull()
    expect((await sessions.authenticate(rotated!.token))?.aal).toBe(2)
    expect(store.revocations).toEqual([
      { id: 'session-1', at: now, reason: 'rotated' },
    ])
    expect(rotated!.session.absoluteExpiresAt).toEqual(absolute)
    expect(rotated!.expiresAt).toEqual(absolute)
    expect(rotated!.session.authTime).toEqual(now)
    expect(rotated!.session.amr).toEqual(['pwd', 'mfa'])
  })

  test('rotate can clear nullable OIDC metadata', async () => {
    const store = new FakeStore()
    const sessions = service(store, () => START)
    const issued = await sessions.mint({ ...input(), oidcSid: 'sid', acr: 'acr-1' })

    const rotated = await sessions.rotate(issued.token, { oidcSid: null, acr: null })

    expect(rotated!.session.oidcSid).toBeNull()
    expect(rotated!.session.acr).toBeNull()
  })

  test('rotate fails closed when the old session is already invalid', async () => {
    const store = new FakeStore()
    const sessions = service(store, () => START)
    const issued = await sessions.mint(input())
    await sessions.revoke(issued.token, 'logout')

    expect(await sessions.rotate(issued.token)).toBeNull()
    expect(store.rows).toHaveLength(1)
  })

  test('rotate rejects an unpaired sealed hint before revoking', async () => {
    const store = new FakeStore()
    const sessions = service(store, () => START)
    const issued = await sessions.mint(input())

    await expect(
      sessions.rotate(issued.token, { idTokenHintCiphertext: Buffer.from('sealed') }),
    ).rejects.toThrow('must be paired')
    expect(store.rows[0]!.revokedAt).toBeNull()
    expect(await sessions.authenticate(issued.token)).not.toBeNull()
  })

  test('rotate logs out when the new row cannot be created', async () => {
    const store = new FakeStore()
    const sessions = service(store, () => START)
    const issued = await sessions.mint(input())
    store.failCreate = true

    await expect(sessions.rotate(issued.token)).rejects.toThrow('insert failed')
    expect(store.rows[0]!.revokedAt).not.toBeNull()
    expect(await sessions.authenticate(issued.token)).toBeNull()
  })

  test('revoke is idempotent and rejects malformed tokens', async () => {
    const store = new FakeStore()
    const sessions = service(store, () => START)
    const issued = await sessions.mint(input())

    expect(await sessions.revoke(issued.token, 'logout')).toBe(true)
    expect(await sessions.revoke(issued.token, 'logout')).toBe(false)
    expect(await sessions.revoke('not-a-token', 'logout')).toBe(false)
  })

  test('reject invalid timeout configuration', () => {
    expect(
      () =>
        new SessionService({
          store: new FakeStore(),
          idleTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS + 1,
        }),
    ).toThrow('idle timeout')
    expect(
      () => new SessionService({ store: new FakeStore(), absoluteTimeoutMs: 0 }),
    ).toThrow('positive')
  })
})

function input(): MintSessionInput {
  return {
    userId: 'user-1',
    identityIssuer: 'http://localhost:8080',
    zitadelSessionId: 'zitadel-session',
    oidcSid: null,
    acr: null,
    idTokenHintCiphertext: null,
    keyVersion: null,
    amr: ['pwd'],
    authTime: new Date(START.getTime() - 1_000),
    aal: 1,
    ip: null,
    userAgentHash: null,
  }
}

type MintSessionInput = Parameters<SessionService['mint']>[0]