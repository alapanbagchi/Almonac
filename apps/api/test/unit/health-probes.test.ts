import { describe, expect, test, spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import { errors } from '../../src/plugins/errors'
import { healthRouter } from '../../src/routes/health.router'
import { liveness } from '../../src/controllers/health/liveness'
import { readiness } from '../../src/controllers/health/readiness'

function quietConsole() {
  return spyOn(console, 'error').mockImplementation(() => {})
}

describe('health probes', () => {
  test('liveness reports the process is up', () => {
    expect(liveness()).toEqual({ status: 'ok' })
  })

  test('readiness passes when the database check succeeds', async () => {
    await expect(readiness({ checkDatabase: async () => {} })).resolves.toEqual({
      status: 'ok',
    })
  })

  test('readiness reports unavailable without leaking the driver error', async () => {
    const log = quietConsole()
    try {
      const result = await readiness({
        checkDatabase: async () => {
          throw new Error('password=supersecret host=db.internal')
        },
      })

      expect(result).toEqual({ status: 'unavailable' })
      expect(JSON.stringify(result)).not.toContain('supersecret')
    } finally {
      log.mockRestore()
    }
  })

  test('readiness fails closed when the check hangs', async () => {
    const log = quietConsole()
    try {
      const result = await readiness({
        checkDatabase: () => new Promise<void>(() => {}),
        timeoutMs: 10,
      })

      expect(result).toEqual({ status: 'unavailable' })
    } finally {
      log.mockRestore()
    }
  })

  test('the router serves liveness and a 503 readiness body', async () => {
    const log = quietConsole()
    try {
      const app = new Elysia()
        .use(errors)
        .use(
          healthRouter({
            checkDatabase: async () => {
              throw new Error('password=supersecret')
            },
          }),
        )

      const live = await app.handle(new Request('http://localhost/health'))
      expect(live.status).toBe(200)
      expect(await live.json()).toEqual({ status: 'ok' })

      const ready = await app.handle(new Request('http://localhost/health/ready'))
      expect(ready.status).toBe(503)
      const body = await ready.json()
      expect(body).toEqual({ status: 'unavailable' })
      expect(JSON.stringify(body)).not.toContain('supersecret')
    } finally {
      log.mockRestore()
    }
  })
})
