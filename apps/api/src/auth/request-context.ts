import { createHash } from 'node:crypto'
import type { LoginRequestContext } from './login-service'

export interface RequestServer {
  requestIP?: (request: Request) => { address?: string } | null
}

/** The peer address Bun sees. A proxy in front of the API must preserve it. */
export function clientIp(
  request: Request,
  server: RequestServer | null | undefined,
): string | null {
  return server?.requestIP?.(request)?.address ?? null
}

/** IP address and a one-way user-agent fingerprint for the audit record. */
export function requestContext(
  request: Request,
  server: RequestServer | null | undefined,
  requestId: string,
): LoginRequestContext {
  const agent = request.headers.get('user-agent')?.slice(0, 1_024) ?? ''
  return {
    ip: clientIp(request, server),
    userAgentHash:
      agent.length === 0 ? null : createHash('sha256').update(agent).digest(),
    requestId,
  }
}
