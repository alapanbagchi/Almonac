import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { errors } from '../../src/plugins/errors'
import { MAX_BODY_BYTES, exceedsBodyLimit, security } from '../../src/plugins/security'

function testApp() {
  return new Elysia()
    .use(errors)
    .use(security)
    .get('/health', () => ({ status: 'ok' }))
    .get('/v1/thing', () => ({ ok: true }))
    .post('/echo', ({ body }) => body)
}

describe('security headers', () => {
  it('denies framing, sniffing and referrer leaks on every response', async () => {
    const response = await testApp().handle(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.get('cache-control')).toBeNull()
  })

  it('never caches an authenticated route', async () => {
    const response = await testApp().handle(new Request('http://localhost/v1/thing'))

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps the headers when a request fails', async () => {
    const response = await testApp().handle(new Request('http://localhost/missing'))

    expect(response.status).toBe(404)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
})

describe('body limit', () => {
  it('accepts a declared length at the limit and rejects one above it', () => {
    expect(exceedsBodyLimit(null)).toBe(false)
    expect(exceedsBodyLimit('not a number')).toBe(false)
    expect(exceedsBodyLimit(String(MAX_BODY_BYTES))).toBe(false)
    expect(exceedsBodyLimit(String(MAX_BODY_BYTES + 1))).toBe(true)
  })

  it('answers an oversized body with the error envelope', async () => {
    const server = testApp().listen(0)
    try {
      const port = server.server?.port
      expect(port).toBeTruthy()

      const response = await fetch(`http://127.0.0.1:${port}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'x'.repeat(MAX_BODY_BYTES + 512) }),
      })
      const body = (await response.json()) as { error: { code: string; requestId: string } }

      expect(response.status).toBe(413)
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
      expect(body.error.requestId).toBeTruthy()
      expect(body.error.requestId).toBe(response.headers.get('x-request-id') ?? '')
    } finally {
      await server.stop()
    }
  })

  it('still accepts a small body', async () => {
    const server = testApp().listen(0)
    try {
      const response = await fetch(`http://127.0.0.1:${server.server?.port}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    } finally {
      await server.stop()
    }
  })
})
