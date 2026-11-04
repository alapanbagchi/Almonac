import type { DatabaseQuery, DatabaseResult } from '../../src/db/pool'
import type { AuditEvent, AuditSink } from '../../src/shared/audit-writer'
import type {
  AuthDependencies,
  LoginRequestContext,
} from '../../src/controllers/auth/dependencies'
import type { OidcProvider } from '../../src/adapters/oidc/provider'
import type { LoginClient, SessionCredentials } from '../../src/adapters/zitadel/login-client'
import type { PasswordHasher } from '../../src/shared/password-hash'
import type { MembershipAccess, SessionAccess } from '../../src/repositories/access-repository'
import { sealingKey, type SealingKey } from '../../src/shared/sealed'

export const NOW = new Date('2026-11-05T10:00:00.000Z')
export const TEST_KEY: SealingKey = sealingKey(1, new Uint8Array(32).fill(7))

export const CONTEXT: LoginRequestContext = {
  ip: '203.0.113.7',
  userAgentHash: Buffer.alloc(32, 3),
  requestId: 'req-1',
}

export interface QueryHandler {
  readonly match: RegExp
  /** Static rows, or a builder over the statement's parameters. */
  readonly rows: readonly unknown[] | ((values: unknown[]) => readonly unknown[])
}

/** A database double that answers by statement shape and records the SQL. */
export class FakeDatabase implements DatabaseQuery {
  readonly statements: { text: string; values: unknown[] }[] = []

  constructor(private readonly handlers: readonly QueryHandler[] = []) {}

  async query(text: string, values: unknown[] = []): Promise<DatabaseResult> {
    this.statements.push({ text, values })
    const handler = this.handlers.find((candidate) => candidate.match.test(text))
    if (handler === undefined) return { rows: [] }
    return {
      rows: typeof handler.rows === 'function' ? handler.rows(values) : handler.rows,
    }
  }

  statementsMatching(pattern: RegExp): { text: string; values: unknown[] }[] {
    return this.statements.filter((statement) => pattern.test(statement.text))
  }
}

export class RecordingAudit implements AuditSink {
  readonly events: AuditEvent[] = []

  async write(event: AuditEvent): Promise<void> {
    this.events.push(event)
  }
}

export class RecordingMetrics {
  readonly counts: { name: string; attributes?: Record<string, string> }[] = []

  count(name: string, attributes?: Record<string, string>): void {
    this.counts.push(attributes === undefined ? { name } : { name, attributes })
  }
}

export function fakeOidc(overrides: Partial<OidcProvider> = {}): OidcProvider {
  return {
    async authorizationUrl(input) {
      return `https://id.example.test/oauth/v2/authorize?state=${input.state}&nonce=${input.nonce}&code_challenge=${input.challenge}`
    },
    async exchangeCode() {
      return 'id-token'
    },
    async verifyIdToken() {
      throw new Error('verifyIdToken is not used by this test')
    },
    async endSessionUrl() {
      return null
    },
    ...overrides,
  }
}

const CREDENTIALS: SessionCredentials = { sessionId: 'sess-1', sessionToken: 'token-1' }

export function fakeLoginClient(overrides: Partial<LoginClient> = {}): LoginClient {
  return {
    async start() {
      return 'auth-request-1'
    },
    async signIn() {
      return CREDENTIALS
    },
    async complete() {
      return 'http://api.test/v1/auth/callback?code=code-1&state=state-1'
    },
    ...overrides,
  }
}

export function fakePasswords(hash: PasswordHasher['hash'] = async () => 'bcrypt-hash'): PasswordHasher {
  return { hash }
}

/**
 * A complete dependency set for the auth slice. Every test overrides only what
 * it exercises, so a missing fake fails loudly instead of reaching the network.
 */
export function baseDependencies(
  overrides: Partial<AuthDependencies> = {},
): AuthDependencies {
  const db = overrides.db ?? new FakeDatabase()
  const base: AuthDependencies = {
    db,
    transaction: async (run) => run(db),
    oidc: fakeOidc(),
    sealingKey: TEST_KEY,
    audit: new RecordingAudit(),
    mailer: { async send() {} },
    identities: { async createVerifiedHumanUser() { return 'identity-1' } },
    loginClient: fakeLoginClient(),
    passwords: fakePasswords(),
    clock: () => NOW,
  }
  return { ...base, ...overrides }
}

/** Echo the insert parameters back as the row a `returning` would produce. */
export function loginAttemptRow(values: unknown[]): Record<string, unknown>[] {
  const expiresAt = values[9]
  return [
    {
      id: 'attempt-1',
      user_id: values[0] ?? null,
      state_hash: values[1],
      nonce_hash: values[2],
      pkce_verifier_ciphertext: values[3],
      key_version: values[4],
      return_to: values[5],
      purpose: values[6],
      ip: values[7] ?? null,
      user_agent_hash: values[8] ?? null,
      created_at: NOW,
      expires_at: expiresAt instanceof Date ? expiresAt : NOW,
      consumed_at: null,
    },
  ]
}

export function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-1',
    user_id: 'user-1',
    identity_issuer: 'https://id.example.test',
    token_hash: Buffer.alloc(32, 1),
    zitadel_session_id: 'sess-1',
    oidc_sid: 'sid-1',
    acr: 'urn:zitadel:iam:action:2fa{mfa}',
    id_token_hint_ciphertext: null,
    key_version: null,
    amr: ['pwd', 'otp'],
    auth_time: NOW,
    aal: 2,
    created_at: NOW,
    last_seen_at: NOW,
    idle_expires_at: new Date(NOW.getTime() + 15 * 60 * 1_000),
    absolute_expires_at: new Date(NOW.getTime() + 8 * 60 * 60 * 1_000),
    revoked_at: null,
    revoke_reason: null,
    ip: '203.0.113.7',
    user_agent_hash: Buffer.alloc(32, 3),
    ...overrides,
  }
}

export function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    identity_issuer: 'https://id.example.test',
    zitadel_sub: 'subject-1',
    email: 'ada@example.test',
    email_verified_at: NOW,
    display_name: 'Ada Lovelace',
    home_organisation_id: null,
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
    last_login_at: null,
    ...overrides,
  }
}

export function access(memberships: MembershipAccess[] = []): SessionAccess {
  return { memberships, permissions: ['session:read'] }
}
