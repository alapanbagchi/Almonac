import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { invitationBody } from '../../src/routes/invitations.router'

const ROLE_ID = '33333333-3333-4333-8333-333333333333'

/** The form sends null for an organisation-wide invitation, not an absent field. */
const app = new Elysia().post('/', { body: invitationBody }, ({ body }) => body)

function invite(hospitalId: string | null | undefined): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'person@example.test',
      ...(hospitalId === undefined ? {} : { hospitalId }),
      roleIds: [ROLE_ID],
    }),
  })
}

describe('invitation body', () => {
  test('accepts null for an organisation-wide invitation', async () => {
    const response = await app.handle(invite(null))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ hospitalId: null })
  })

  test('accepts an omitted hospital and a hospital id', async () => {
    expect((await app.handle(invite(undefined))).status).toBe(200)
    expect((await app.handle(invite('22222222-2222-4222-8222-222222222222'))).status).toBe(200)
  })

  test('rejects a hospital that is not a uuid', async () => {
    expect((await app.handle(invite('not-a-uuid'))).status).toBe(422)
  })
})
