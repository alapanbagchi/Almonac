import { t } from 'elysia'

export const healthResponse = t.Object(
  { status: t.Literal('ok') },
  { description: 'The API process is running.' },
)
