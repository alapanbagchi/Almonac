import { createHash } from 'node:crypto'
import type { LoginRequestContext } from './login-service'

export interface RequestServer {
  requestIP?: (request: Request) => { address?: string } | null
}

/**
 * The global error plugin derives a request ID, but its type does not cross
 * plugin boundaries. Read it at runtime and mint one only if it is absent.
 */
export function requestIdOf(context: object): string {
  const value: unknown = Reflect.get(context, 'requestId')
  return typeof value === 'string' && value.length > 0 ? value : crypto.randomUUID()
}

/** IP address and a one-way user-agent fingerprint for the audit record. */
export function requestContext(
  request: Request,
  server: RequestServer | null | undefined,
  requestId: string,
): LoginRequestContext {
  const agent = request.headers.get('user-agent')?.slice(0, 1_024) ?? ''
  return {
    ip: server?.requestIP?.(request)?.address ?? null,
    userAgentHash:
      agent.length === 0 ? null : createHash('sha256').update(agent).digest(),
    requestId,
  }
}
