import { pageRequest, pageResponse } from '../../shared/pagination'
import { createBreakGlassRepository } from '../../repositories/break-glass-repository'
import { grantResponse, type GrantResponse } from './responses'
import {
  BREAK_GLASS_APPROVER_PERMISSIONS,
  type BreakGlassContext,
  type BreakGlassDependencies,
} from './support'

export interface ListGrantsQuery {
  readonly hospitalId?: string
  readonly limit?: string
  readonly offset?: string
}

/**
 * Approvers see every grant so they can review one they did not open; everyone
 * else sees only their own.
 */
export async function listGrants(
  dependencies: Pick<BreakGlassDependencies, 'db' | 'transaction' | 'hasAnyPlatformPermission'>,
  context: BreakGlassContext,
  query: ListGrantsQuery,
): Promise<{ items: GrantResponse[]; nextOffset: number | null }> {
  const approver = await dependencies.hasAnyPlatformPermission(
    context.actor.id,
    BREAK_GLASS_APPROVER_PERMISSIONS,
  )
  const page = await createBreakGlassRepository(dependencies.db).list(
    approver ? null : context.actor.id,
    query.hospitalId ?? null,
    pageRequest(query),
  )
  return pageResponse(page, grantResponse)
}