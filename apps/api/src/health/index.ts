import { Elysia } from 'elysia'
import { healthResponse } from './model'

export const health = new Elysia({
  name: 'system.health',
  prefix: '/health',
  tags: ['System'],
}).get(
  '',
  {
    response: { 200: healthResponse },
    detail: {
      summary: 'Liveness probe',
      tags: ['System'],
      security: [],
    },
  },
  () => ({ status: 'ok' as const }),
)
