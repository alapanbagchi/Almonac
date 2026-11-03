import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { errors } from '../../src/plugins/errors'
import { AppError } from '../../src/shared/errors'

const originalConsoleError = console.error

afterEach(() => {
  console.error = originalConsoleError
})

function probeApp(handler: () => never) {
  return new Elysia().use(errors).get('/probe', handler)
}

describe('error envelope', () => {
  test('maps an unknown route to NOT_FOUND', async () => {
    const response = await new Elysia()
      .use(errors)
      .handle(new Request('http://localhost/missing'))
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
    const app = probeApp(() => {
      throw new AppError('RULE_VIOLATION', 422, 'Rejected by a business rule.')
    })
    const response = await app.handle(new Request('http://localhost/probe'))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'RULE_VIOLATION', message: 'Rejected by a business rule.' },
    })
  })

  test('keeps the derived request ID in the error response', async () => {
    console.error = () => {}
    let derived = ''
    const app = new Elysia().use(errors).get('/probe', (context) => {
      derived = String(Reflect.get(context, 'requestId'))
      throw new Error('boom')
    })
    const response = await app.handle(new Request('http://localhost/probe'))
    const body = (await response.json()) as {
      error: { requestId: string }
    }

    expect(response.status).toBe(500)
    expect(body.error.requestId).toBe(derived)
    expect(response.headers.get('x-request-id')).toBe(derived)
  })

  test('maps an unexpected error to INTERNAL without leaking it', async () => {
    const logged: string[] = []
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }

    const error = new Error('password=hunter2')
    Object.assign(error, { code: 'PASSWORD_hunter2\n' })
    const app = probeApp(() => {
      throw error
    })

    const response = await app.handle(new Request('http://localhost/probe'))
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: { code: 'INTERNAL' } })
    expect(JSON.stringify(body)).not.toContain('hunter2')
    expect(logged.join(' ')).not.toContain('hunter2')
    expect(logged.join(' ')).toContain('name=Error')
  })
})
