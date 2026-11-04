import { t } from 'elysia'
import { pageLimit } from '../../../shared/pagination'
import { uuid } from '../../admin-model'

/** One organisation's log, optionally narrowed to one hospital. */
export const auditQuery = t.Object({
  hospitalId: t.Optional(uuid),
  limit: pageLimit,
  cursor: t.Optional(t.String({ maxLength: 60 })),
})

export interface AuditQuery {
  readonly hospitalId?: string
  readonly limit?: string
  readonly cursor?: string
}
