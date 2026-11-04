import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { errors } from '../../src/plugins/errors'
import { authRouter } from '../../src/routes/auth.router'
import {
  FakeDatabase,
  baseDependencies,
  sessionRow,
  userRow,
} from './auth-fixtures'

const VALID_TOKEN = 'A'.repeat(43)

function api(dependencies = baseDependencies()) {
  return new Elysia().use(errors).use(authRouter(dependencies))
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>)[key]
}

async function errorCode(response: Response): Promise<string> {
  const parsed: unknown = JSON.parse(await response.text())
  const code = field(field(parsed, 'error'), 'code')
  return typeof code === 'string' ? code : 'missing'
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://api.test${path}`, init)
}

describe('auth route denials', () => {
  test('logout without a bearer is denied before any work', async () => {
    const db = new FakeDatabase()
    const response = await api(baseDependencies({ db })).handle(
      request('/v1/auth/logout', { method: 'POST' }),
    )

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('AUTH_REQUIRED')
    expect(db.statements).toHaveLength(0)
  })

  test('session read without a bearer is unauthenticated', async () => {
    const db = new FakeDatabase()
    const response = await api(baseDependencies({ db })).handle(request('/v1/auth/session'))

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('UNAUTHENTICATED')
    expect(db.statements).toHaveLength(0)
  })

  test('a malformed bearer never reaches the database', async () => {
    const db = new FakeDatabase()
    const response = await api(baseDependencies({ db })).handle(
      request('/v1/auth/session', { headers: { authorization: 'Bearer nope' } }),
    )

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('UNAUTHENTICATED')
    expect(db.statements).toHaveLength(0)
  })

  test('a malformed authorization scheme is rejected', async () => {
    const response = await api().handle(
      request('/v1/auth/session', { headers: { authorization: `Basic ${VALID_TOKEN}` } }),
    )

    expect(response.status).toBe(401)
  })

  test('an unknown but well-formed token is denied after one lookup', async () => {
    const db = new FakeDatabase()
    const response = await api(baseDependencies({ db })).handle(
      request('/v1/auth/session', { headers: { authorization: `Bearer ${VALID_TOKEN}` } }),
    )

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('UNAUTHENTICATED')
    expect(db.statementsMatching(/identity\.web_session/)).toHaveLength(1)
  })

  test('a revoked session is denied', async () => {
    const db = new FakeDatabase([
      { match: /identity\.web_session/, rows: [sessionRow({ revoked_at: new Date() })] },
    ])
    const response = await api(baseDependencies({ db })).handle(
      request('/v1/auth/session', { headers: { authorization: `Bearer ${VALID_TOKEN}` } }),
    )

    expect(response.status).toBe(401)
  })

  test('a deactivated user is denied and the session is revoked', async () => {
    const db = new FakeDatabase([
      { match: /identity\.web_session/, rows: [sessionRow()] },
      { match: /identity\.app_user/, rows: [userRow({ status: 'deactivated' })] },
    ])
    const response = await api(baseDependencies({ db })).handle(
      request('/v1/auth/session', { headers: { authorization: `Bearer ${VALID_TOKEN}` } }),
    )

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('UNAUTHENTICATED')
    expect(
      db.statementsMatching(/update identity\.web_session[\s\S]*revoke_reason/).length,
    ).toBeGreaterThan(0)
  })

  test('step-up without a bearer starts no attempt', async () => {
    const db = new FakeDatabase()
    const response = await api(baseDependencies({ db })).handle(
      request('/v1/auth/step-up-attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(401)
    expect(db.statements).toHaveLength(0)
  })

  test('a callback with a short state fails validation', async () => {
    const response = await api().handle(
      request('/v1/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'code-1', state: 'too-short' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe('VALIDATION_FAILED')
  })

  test('an unknown session path is not served', async () => {
    const response = await api().handle(request('/v1/auth/unknown'))
    expect(response.status).toBe(404)
  })
})
