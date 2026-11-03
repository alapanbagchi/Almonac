import type { AuditSink } from '../audit/audit-writer'
import { AuditWriter } from '../audit/audit-writer'
import type { DatabaseQuery } from '../db/pool'
import type { WebSession } from '../identity/session-repository'
import type { SessionService } from '../identity/session-service'
import type { SealingKey } from '../shared/sealed'
import { open } from '../shared/sealed'
import { safeName } from '../shared/log'
import { SESSION_ID_TOKEN_HINT_AAD } from './aad'
import type { OidcProvider } from './oidc-provider'

export interface LogoutResult {
  readonly endSessionUrl: string | null
}

export interface LogoutContext {
  readonly requestId: string | null
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

export interface LogoutServiceOptions {
  readonly sessions: SessionService
  readonly oidc: OidcProvider
  readonly audit: AuditSink
  readonly sealingKey: SealingKey
}

/**
 * Revoke the local session first, then build the identity-provider logout URL
 * from the sealed ID token hint. A corrupt hint never keeps a session alive;
 * it only omits the provider redirect.
 */
export class LogoutService {
  constructor(private readonly options: LogoutServiceOptions) {}

  /**
   * Logout is idempotent. An unknown token returns no provider URL; an expired
   * or revoked token still returns one so the identity-provider session ends
   * on a shared workstation.
   */
  async logout(token: string, context: LogoutContext): Promise<LogoutResult> {
    const session = await this.options.sessions.findByToken(token)
    if (session === null) return { endSessionUrl: null }

    if (await this.options.sessions.revoke(token, 'logout')) {
      await this.options.audit.write({
        actorUserId: session.userId,
        actorType: 'user',
        sessionId: session.id,
        organisationId: null,
        hospitalId: null,
        eventType: 'auth.logout',
        outcome: 'success',
        targetType: 'session',
        targetId: session.id,
        requestId: context.requestId,
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: { session_id: session.id },
      })
    }

    return { endSessionUrl: await this.endSessionUrl(session) }
  }

  private async endSessionUrl(session: WebSession): Promise<string | null> {
    if (
      session.idTokenHintCiphertext === null ||
      session.keyVersion === null
    ) {
      return null
    }

    try {
      const hint = open(
        {
          ciphertext: session.idTokenHintCiphertext,
          keyVersion: session.keyVersion,
        },
        this.options.sealingKey,
        SESSION_ID_TOKEN_HINT_AAD,
      )
      return await this.options.oidc.endSessionUrl(hint)
    } catch (error) {
      console.error('[api] logout hint could not be opened:', safeName(error))
      return null
    }
  }
}

export function createLogoutService(
  db: DatabaseQuery,
  options: Omit<LogoutServiceOptions, 'audit'>,
): LogoutService {
  return new LogoutService({ ...options, audit: new AuditWriter(db) })
}
