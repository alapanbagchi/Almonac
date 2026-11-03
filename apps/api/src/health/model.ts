import { t } from 'elysia'

export const healthResponse = t.Object(
  { status: t.Literal('ok') },
  { description: 'The API process is running.' },
)

export const readyResponse = t.Object(
  { status: t.Literal('ok') },
  { description: 'The API can reach the control database.' },
)

export const unavailableResponse = t.Object(
  { status: t.Literal('unavailable') },
  { description: 'The API cannot reach the control database.' },
)
