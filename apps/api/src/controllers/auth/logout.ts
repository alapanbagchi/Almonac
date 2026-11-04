import type { WebSession } from '../../repositories/session-repository'
import { open } from '../../shared/sealed'
import { safeName } from '../../shared/log'
import type { AuthDependencies, LoginRequestContext } from './dependencies'
import { SESSION_ID_TOKEN_HINT_AAD, sessionServiceOf } from './session'

export interface LogoutDto {
  readonly endSessionUrl: string | null
}

/**
 * Revoke the local session first, then build the identity-provider logout URL
 * from the sealed ID token hint. A corrupt hint never keeps a session alive; it
 * only omits the provider redirect. Logout is idempotent.
 */
export async function logout(
  dependencies: AuthDependencies,
  token: string,
  context: LoginRequestContext,
): Promise<LogoutDto> {
  const sessions = sessionServiceOf(dependencies)
  const session = await sessions.findByToken(token)
  if (session === null) return { endSessionUrl: null }

  if (await sessions.revoke(token, 'logout')) {
    await dependencies.audit.write({
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

  return { endSessionUrl: await endSessionUrl(dependencies, session) }
}

async function endSessionUrl(
  dependencies: AuthDependencies,
  session: WebSession,
): Promise<string | null> {
  if (session.idTokenHintCiphertext === null || session.keyVersion === null) {
    return null
  }

  try {
    const hint = open(
      {
        ciphertext: session.idTokenHintCiphertext,
        keyVersion: session.keyVersion,
      },
      dependencies.sealingKey,
      SESSION_ID_TOKEN_HINT_AAD,
    )
    return await dependencies.oidc.endSessionUrl(hint)
  } catch (error) {
    console.error('[api] logout hint could not be opened:', safeName(error))
    return null
  }
}
