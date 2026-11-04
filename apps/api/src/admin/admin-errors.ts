import { AppError, ConflictError, RuleViolation } from '../shared/errors'
import { ZitadelRejectedError, ZitadelUnavailableError } from './zitadel-management-client'

export { conflict, forbidden, notFound, ruleViolation } from '../shared/errors'

/**
 * The provider failures administration answers itself. Every other outcome
 * (slug, domain, membership, role conflicts) is classified by the repository
 * that saw the constraint and mapped by the service that owns the policy.
 */
export function asAdminError(error: unknown): unknown {
  if (error instanceof ConflictError) {
    return new AppError('CONFLICT', 409, error.message, { cause: error })
  }
  if (error instanceof RuleViolation) {
    return new AppError('RULE_VIOLATION', 422, error.message, { cause: error })
  }
  if (error instanceof ZitadelUnavailableError) {
    return new AppError('UNAVAILABLE', 503, 'The identity provider is temporarily unavailable.', {
      cause: error,
    })
  }
  if (error instanceof ZitadelRejectedError) {
    return new AppError('UNAVAILABLE', 503, 'The identity provider rejected this change.', {
      cause: error,
    })
  }
  return error
}
