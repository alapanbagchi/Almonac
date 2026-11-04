import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { breakGlassGrantBody } from '../../src/break-glass/break-glass-model'
import { errors } from '../../src/plugins/errors'

const app = new Elysia()
  .use(errors)
  .post('/probe', { body: breakGlassGrantBody }, () => 'ok')

const subject = '11111111-1111-4111-8111-111111111111'
const hospital = '22222222-2222-4222-8222-222222222222'

function request(body: unknown) {
  return app.handle(
    new Request('http://localhost/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('break-glass grant body', () => {
  test('accepts an emergency request without a subject', async () => {
    const response = await request({
      hospitalId: hospital,
      mode: 'emergency',
      reason: 'Unresponsive patient',
    })
    expect(response.status).toBe(200)
  })

  test('accepts a pre-approved request with a subject', async () => {
    const response = await request({
      hospitalId: hospital,
      mode: 'pre_approved',
      reason: 'Covering clinician',
      userId: subject,
    })
    expect(response.status).toBe(200)
  })

  test('rejects a subject on an emergency request', async () => {
    const response = await request({
      hospitalId: hospital,
      mode: 'emergency',
      reason: 'Unresponsive patient',
      userId: subject,
    })
    expect(response.status).toBe(400)
  })

  test('rejects a pre-approved request without a subject', async () => {
    const response = await request({
      hospitalId: hospital,
      mode: 'pre_approved',
      reason: 'Covering clinician',
    })
    expect(response.status).toBe(400)
  })
})
