import { t } from 'elysia'

/**
 * Offset pagination shared by the administrative and break-glass list routes.
 * Repositories fetch one row beyond the requested page so the route can tell
 * the caller whether another page exists without a second count query.
 */
export const paginationFields = {
  limit: t.Optional(t.String({ pattern: '^[0-9]{1,3}$' })),
  offset: t.Optional(t.String({ pattern: '^[0-9]{1,6}$' })),
}

export interface PageRequest {
  readonly limit: number
  readonly offset: number
}

export interface Page<T> {
  readonly items: T[]
  readonly nextOffset: number | null
}

export function pageRequest(query: { limit?: string; offset?: string }): PageRequest {
  return {
    limit: bounded(query.limit, 50, 1, 100),
    offset: bounded(query.offset, 0, 0, 1_000_000),
  }
}

export function pageOf<T>(rows: readonly T[], request: PageRequest): Page<T> {
  return {
    items: rows.slice(0, request.limit),
    nextOffset: rows.length > request.limit ? request.offset + request.limit : null,
  }
}

/** Map a page while preserving its cursor. */
export function pageResponse<T, R>(
  page: Page<T>,
  map: (item: T) => R,
): { items: R[]; nextOffset: number | null } {
  return { items: page.items.map(map), nextOffset: page.nextOffset }
}

export function pageSchema<T extends Parameters<typeof t.Array>[0]>(item: T) {
  return t.Object({
    items: t.Array(item),
    nextOffset: t.Union([t.Number(), t.Null()]),
  })
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}
