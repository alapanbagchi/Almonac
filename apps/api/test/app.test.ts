import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { app } from '../src/app'
import { errors } from '../src/plugins/errors'
import { AppError } from '../src/shared/errors'

describe('health', () => {
  test('returns ok with a request id', async () => {
    const response = await app.handle(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(typeof response.headers.get('x-request-id')).toBe('string')
  })
})

describe('error envelope', () => {
  test('maps an unknown route to NOT_FOUND', async () => {
    const response = await app.handle(new Request('http://localhost/missing'))
    const body = (await response.json()) as {
      error: { code: string; requestId: string }
    }

    const header = response.headers.get('x-request-id')

    expect(response.status).toBe(404)
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(header).not.toBeNull()
    expect(body.error.requestId).toBe(header ?? '')
  })

  test('maps an AppError to its status and code', async () => {
    const probe = new Elysia()
      .use(errors)
      .get('/probe', () => {
        throw new AppError('RULE_VIOLATION', 422, 'Rejected by a business rule.')
      })

    const response = await probe.handle(new Request('http://localhost/probe'))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'RULE_VIOLATION', message: 'Rejected by a business rule.' },
    })
  })

  test('maps an unexpected error to INTERNAL without leaking it', async () => {
    const probe = new Elysia()
      .use(errors)
      .get('/probe', () => {
        throw new Error('password=hunter2')
      })

    const response = await probe.handle(new Request('http://localhost/probe'))
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: { code: 'INTERNAL' } })
    expect(JSON.stringify(body)).not.toContain('hunter2')
  })
})
