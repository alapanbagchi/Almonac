import { NextResponse } from 'next/server'

import { api, type ErrorEnvelope } from '@/lib/api/client'

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    'message' in value.error &&
    'requestId' in value.error
  )
}

/**
 * Scaffolding smoke test: proves the web app can reach the Elysia service
 * through the typed Eden client. Replace with real feature routes.
 */
export async function GET() {
  const { data, error, status } = await api.health.get()

  if (error) {
    if (isErrorEnvelope(error.value)) {
      return NextResponse.json(error.value, { status })
    }

    // The request never reached the API, so there is no API request ID.
    return NextResponse.json(
      {
        error: {
          code: 'UNAVAILABLE',
          message: 'The API is unavailable.',
          requestId: crypto.randomUUID(),
        },
      } satisfies ErrorEnvelope,
      { status },
    )
  }

  return NextResponse.json(data)
}
