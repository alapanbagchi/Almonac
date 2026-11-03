import { afterEach, describe, expect, test } from 'bun:test'
import { spyOn } from 'bun:test'
import { createTestApp } from '../helpers/app'

const originalConsoleError = console.error

afterEach(() => {
  console.error = originalConsoleError
})

describe('health routes', () => {
  test('returns liveness with a request id', async () => {
    const app = createTestApp()
    const response = await app.handle(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(typeof response.headers.get('x-request-id')).toBe('string')
  })

  test('returns readiness when the database check passes', async () => {
    const app = createTestApp()
    const response = await app.handle(new Request('http://localhost/health/ready'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('returns 503 without detail when the database check fails', async () => {
    console.error = spyOn(console, 'error').mockImplementation(() => {})
    const app = createTestApp(async () => {
      throw new Error('password=hunter2')
    })

    const response = await app.handle(new Request('http://localhost/health/ready'))
    const body = (await response.json()) as { status: string }

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(body)).not.toContain('hunter2')
  })

  test('returns 503 when the database check exceeds the timeout', async () => {
    console.error = spyOn(console, 'error').mockImplementation(() => {})
    const app = createTestApp(
      () => new Promise((resolve) => setTimeout(resolve, 1_000)),
      5,
    )

    const response = await app.handle(new Request('http://localhost/health/ready'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unavailable' })
  })
})
