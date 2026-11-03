import { AppError } from '../shared/errors'
import { isSessionToken } from '../shared/tokens'
import type { AppUser } from '../identity/app-user-repository'
import type { WebSession } from '../identity/session-repository'

export interface UserLookup {
  findById(id: string): Promise<AppUser | null>
}

export interface SessionAuthenticator {
  authenticate(token: string): Promise<WebSession | null>
  revoke(token: string, reason: string): Promise<boolean>
}

export interface AuthenticatedRequest {
  readonly token: string
  readonly session: WebSession
  readonly user: AppUser
}

const BEARER_PATTERN = /^Bearer ([^\s]+)$/i

export function readBearerToken(header: string | null | undefined): string | null {
  if (header === null || header === undefined) return null

  const match = BEARER_PATTERN.exec(header.trim())
  const token = match?.[1]
  return token !== undefined && isSessionToken(token) ? token : null
}

/**
 * Resolve a bearer session for the private API hop. The API never reads
 * cookies; a missing or malformed credential is an authentication failure, not
 * a validation error.
 */
export async function authenticateBearer(
  header: string | null | undefined,
  sessions: SessionAuthenticator,
  users: UserLookup,
): Promise<AuthenticatedRequest> {
  const token = readBearerToken(header)
  if (token === null) throw authRequired()

  const session = await sessions.authenticate(token)
  if (session === null) throw authFailed()

  const user = await users.findById(session.userId)
  if (user === null || user.status !== 'active') {
    await sessions.revoke(token, 'user_inactive').catch(() => false)
    throw authFailed()
  }

  return { token, session, user }
}

function authRequired(): AppError {
  return new AppError('AUTH_REQUIRED', 401, 'Authentication is required.')
}

function authFailed(): AppError {
  return new AppError('AUTH_FAILED', 401, 'Authentication failed.')
}