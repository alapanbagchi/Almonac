import { describe, expect, test } from 'bun:test'
import {
  createSessionService,
  type SessionServiceOptions,
  type SessionStore,
} from '../../src/controllers/auth/session'
import type { NewWebSession, WebSession } from '../../src/repositories/session-repository'
import { hashToken } from '../../src/shared/tokens'
import { NOW, RecordingMetrics } from './auth-fixtures'

const IDLE_MS = 15 * 60 * 1_000
const ABSOLUTE_MS = 8 * 60 * 60 * 1_000

type StoredSession = { -readonly [K in keyof WebSession]: WebSession[K] }

/** In-memory session store with the same conditional writes as the SQL. */
class MemoryStore implements SessionStore {
  readonly rows: StoredSession[] = []
  touches = 0
  creates = 0

  async create(input: NewWebSession): Promise<WebSession> {
    this.creates += 1
    const row: StoredSession = {
      id: `session-${this.creates}`,
      ...input,
      amr: [...input.amr],
      createdAt: NOW,
      lastSeenAt: NOW,
      revokedAt: null,
      revokeReason: null,
    }
    this.rows.push(row)
    return row
  }

  async findByTokenHash(tokenHash: Buffer): Promise<WebSession | null> {
    return (
      this.rows.find(
        (row) => row.tokenHash.equals(tokenHash) && row.revokedAt === null,
      ) ?? null
    )
  }

  async touch(id: string, at: Date, idleExpiresAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row === undefined) return false
    this.touches += 1
    row.lastSeenAt = at
    row.idleExpiresAt = idleExpiresAt
    return true
  }

  async revoke(id: string, at: Date, reason: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row === undefined || row.revokedAt !== null) return false
    row.revokedAt = at
    row.revokeReason = reason
    return true
  }

  expireIdle(id: string): void {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row !== undefined) row.idleExpiresAt = new Date(NOW.getTime() - 1)
  }

  expireAbsolute(id: string): void {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (row !== undefined) row.absoluteExpiresAt = new Date(NOW.getTime() - 1)
  }
}

function service(
  store: MemoryStore,
  overrides: Partial<SessionServiceOptions> = {},
) {
  return createSessionService({ store, clock: () => NOW, ...overrides })
}

const MINT = {
  userId: 'user-1',
  identityIssuer: 'https://id.example.test',
  zitadelSessionId: 'sess-1',
  oidcSid: 'sid-1',
  acr: null,
  idTokenHintCiphertext: null,
  keyVersion: null,
  amr: ['pwd', 'otp'],
  authTime: NOW,
  aal: 2,
  ip: '203.0.113.7',
  userAgentHash: null,
}

describe('session service', () => {
  test('mints an opaque token and stores only its hash', async () => {
    const store = new MemoryStore()
    const issued = await service(store).mint(MINT)

    expect(issued.token).toHaveLength(43)
    expect(store.rows[0]?.tokenHash.equals(hashToken(issued.token))).toBe(true)
    expect(store.rows[0]?.tokenHash.equals(Buffer.from(issued.token))).toBe(false)
    expect(issued.expiresAt.toISOString()).toBe(
      new Date(NOW.getTime() + ABSOLUTE_MS).toISOString(),
    )
    expect(store.rows[0]?.idleExpiresAt.toISOString()).toBe(
      new Date(NOW.getTime() + IDLE_MS).toISOString(),
    )
  })

  test('rejects an unpaired id token hint and key version', async () => {
    const store = new MemoryStore()
    await expect(
      service(store).mint({ ...MINT, idTokenHintCiphertext: Buffer.alloc(8), keyVersion: null }),
    ).rejects.toThrow('paired')
    await expect(
      service(store).mint({ ...MINT, idTokenHintCiphertext: null, keyVersion: 1 }),
    ).rejects.toThrow('paired')
    expect(store.creates).toBe(0)
  })

  test('rejects impossible timeout configuration', () => {
    const store = new MemoryStore()
    expect(() => service(store, { idleTimeoutMs: 0 })).toThrow()
    expect(() => service(store, { idleTimeoutMs: 10, absoluteTimeoutMs: 5 })).toThrow()
    expect(() => service(store, { touchIntervalMs: -1 })).toThrow()
  })

  test('a malformed token is denied without touching the database', async () => {
    const store = new MemoryStore()
    let lookups = 0
    const original = store.findByTokenHash.bind(store)
    store.findByTokenHash = async (hash) => {
      lookups += 1
      return original(hash)
    }

    expect(await service(store).authenticate('short')).toBeNull()
    expect(await service(store).findByToken('x'.repeat(43))).toBeNull()
    expect(lookups).toBe(1)
  })

  test('touches at most once per interval and extends the idle expiry', async () => {
    const store = new MemoryStore()
    const sessions = service(store)
    const issued = await sessions.mint(MINT)

    expect(await sessions.authenticate(issued.token)).not.toBeNull()
    expect(store.touches).toBe(0)

    const later = new Date(NOW.getTime() + 2 * 60 * 1_000)
    const touched = await createSessionService({
      store,
      clock: () => later,
    }).authenticate(issued.token)

    expect(touched).not.toBeNull()
    expect(store.touches).toBe(1)
    expect(store.rows[0]?.idleExpiresAt.toISOString()).toBe(
      new Date(later.getTime() + IDLE_MS).toISOString(),
    )
  })

  test('denies an idle-expired, absolute-expired or revoked session', async () => {
    const store = new MemoryStore()
    const sessions = service(store)
    const issued = await sessions.mint(MINT)

    store.expireIdle('session-1')
    expect(await sessions.authenticate(issued.token)).toBeNull()

    store.rows[0]!.idleExpiresAt = new Date(NOW.getTime() + IDLE_MS)
    store.expireAbsolute('session-1')
    expect(await sessions.authenticate(issued.token)).toBeNull()

    store.rows[0]!.absoluteExpiresAt = new Date(NOW.getTime() + ABSOLUTE_MS)
    await sessions.revoke(issued.token, 'logout')
    expect(await sessions.authenticate(issued.token)).toBeNull()
  })

  test('rotate revokes the old session, keeps the absolute expiry and counts it', async () => {
    const store = new MemoryStore()
    const metrics = new RecordingMetrics()
    const sessions = service(store, { metrics })
    const issued = await sessions.mint(MINT)

    const rotated = await sessions.rotate(issued.token, { amr: ['pwd', 'hwk'] })
    expect(rotated).not.toBeNull()
    expect(rotated?.token).not.toBe(issued.token)
    expect(rotated?.expiresAt.toISOString()).toBe(issued.expiresAt.toISOString())
    expect(rotated?.session.amr).toEqual(['pwd', 'hwk'])
    expect(store.rows[0]?.revokeReason).toBe('rotated')
    expect(await sessions.authenticate(issued.token)).toBeNull()
    expect(metrics.counts).toContainEqual({
      name: 'auth.session_revoked',
      attributes: { reason: 'rotated' },
    })
  })

  test('rotate refuses an expired session and leaves no second token', async () => {
    const store = new MemoryStore()
    const sessions = service(store)
    const issued = await sessions.mint(MINT)
    store.expireAbsolute('session-1')

    expect(await sessions.rotate(issued.token)).toBeNull()
    expect(store.creates).toBe(1)
  })

  test('revoke is idempotent and reports the first revocation only', async () => {
    const store = new MemoryStore()
    const sessions = service(store)
    const issued = await sessions.mint(MINT)

    expect(await sessions.revoke(issued.token, 'logout')).toBe(true)
    expect(await sessions.revoke(issued.token, 'logout')).toBe(false)
    expect(await sessions.revoke('a'.repeat(43), 'logout')).toBe(false)
  })
})
