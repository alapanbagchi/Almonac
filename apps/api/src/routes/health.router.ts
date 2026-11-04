import { Elysia, t } from 'elysia'
import { liveness } from '../controllers/health/liveness'
import { readiness, type HealthDependencies } from '../controllers/health/readiness'

const status = <Value extends 'ok' | 'unavailable'>(value: Value, description: string) =>
  t.Object({ status: t.Literal(value) }, { description })

const healthResponse = status('ok', 'The API process is running.')
const readyResponse = status(
  'ok',
  'The API can reach a migrated control database with the expected privileges.',
)
const unavailableResponse = status(
  'unavailable',
  'The API cannot reach a migrated control database with the expected privileges.',
)

const routeDetail = (summary: string) => ({
  summary,
  tags: ['System'],
  security: [],
})

/** Liveness and readiness probes, both without authentication. */
export function healthRouter(dependencies: HealthDependencies) {
  return new Elysia({
    name: 'system.health',
    prefix: '/health',
    tags: ['System'],
  })
    .get(
      '',
      {
        response: { 200: healthResponse },
        detail: routeDetail('Liveness probe'),
      },
      () => liveness(),
    )
    .get(
      '/ready',
      {
        response: { 200: readyResponse, 503: unavailableResponse },
        detail: routeDetail('Readiness probe'),
      },
      async ({ set }) => {
        const result = await readiness(dependencies)
        if (result.status === 'unavailable') set.status = 503
        return result
      },
    )
}
