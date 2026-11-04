import { t } from 'elysia'

/**
 * Offset pagination shared by the administrative and break-glass list routes.
 * Repositories fetch one row beyond the requested page so the route can tell
 * the caller whether another page exists without a second count query.
 */
export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 100
const MAX_OFFSET = 1_000_000

/** The list limit, shared with the cursor-paginated audit route. */
export const pageLimit = t.Optional(t.String({ pattern: '^[0-9]{1,3}$' }))

export const pageOffset = t.Optional(t.String({ pattern: '^[0-9]{1,6}$' }))

const bounds = {
  limit: pageLimit,
  offset: pageOffset,
}

/** The list query every paginated route accepts. */
export const pageQuery = t.Object({ ...bounds })

/** The same query narrowed to one hospital of the organisation. */
export const scopedPageQuery = t.Object({ hospitalId: t.Optional(t.String()), ...bounds })

export interface PageRequest {
  readonly limit: number
  readonly offset: number
}

export interface Page<T> {
  readonly items: T[]
  readonly nextOffset: number | null
}

/** The validated query of a page route, read off the handler context. */
export function pageValues<T extends { limit?: string | null; offset?: string | null }>(
  context: { query: T },
): { limit?: string; offset?: string } {
  const { limit, offset } = context.query
  return {
    ...(typeof limit === 'string' ? { limit } : {}),
    ...(typeof offset === 'string' ? { offset } : {}),
  }
}

export function pageRequest(query: { limit?: string; offset?: string }): PageRequest {
  return {
    limit: bounded(query.limit, 1, MAX_PAGE_LIMIT),
    offset: bounded(query.offset, 0, MAX_OFFSET, 0),
  }
}

/** The audit log pages by cursor; its limit obeys the same bounds. */
export function auditLimit(value: string | undefined): number {
  return bounded(value, 1, MAX_PAGE_LIMIT)
}

export function pageOf<T>(rows: readonly T[], request: PageRequest): Page<T> {
  return {
    items: rows.slice(0, request.limit),
    nextOffset: rows.length > request.limit ? request.offset + request.limit : null,
  }
}

/** Map a page while preserving its next offset. */
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

function bounded(
  value: string | undefined,
  min: number,
  max: number,
  fallback = DEFAULT_PAGE_LIMIT,
): number {
  const parsed = Number(value)
  return value !== undefined && Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback
}
