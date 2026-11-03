import { t } from 'elysia'

const status = <Value extends 'ok' | 'unavailable'>(
  value: Value,
  description: string,
) => t.Object({ status: t.Literal(value) }, { description })

export const healthResponse = status('ok', 'The API process is running.')
export const readyResponse = status(
  'ok',
  'The API can reach a migrated control database with the expected privileges.',
)
export const unavailableResponse = status(
  'unavailable',
  'The API cannot reach a migrated control database with the expected privileges.',
)
