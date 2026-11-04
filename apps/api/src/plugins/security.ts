import { Elysia } from 'elysia'
import { AppError } from '../shared/errors'

/** Every API body is small JSON; anything larger is refused before parsing. */
export const MAX_BODY_BYTES = 64 * 1024

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
} as const

/** True when a declared body length is above the accepted maximum. */
export function exceedsBodyLimit(contentLength: string | null): boolean {
  if (contentLength === null) return false
  const length = Number(contentLength)
  return Number.isFinite(length) && length > MAX_BODY_BYTES
}

/**
 * Applies response headers to every route and refuses oversized bodies.
 *
 * The API answers JSON and never serves a document, so framing and content
 * sniffing are denied outright. Authenticated routes are never cacheable.
 * Bun's server also caps the body at {@link MAX_BODY_BYTES}; this hook turns a
 * declared oversized body into the normal error envelope before parsing.
 */
export const security = new Elysia({ name: 'plugins.security' }).onRequest(
  ({ request, set }) => {
    for (const [name, value] of Object.entries(HEADERS)) set.headers[name] = value
    if (new URL(request.url).pathname.startsWith('/v1/')) {
      set.headers['cache-control'] = 'no-store'
    }
    if (exceedsBodyLimit(request.headers.get('content-length'))) {
      throw new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.')
    }
  },
)
