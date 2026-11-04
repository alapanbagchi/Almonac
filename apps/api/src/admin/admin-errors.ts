import { AppError } from '../shared/errors'
import {
  DomainConflictError,
  HospitalSlugConflictError,
  PrimaryDomainRejectedError,
} from './hospital-repository'
import { MembershipConflictError, RoleAssignmentConflictError } from './membership-admin-repository'
import { OrganisationSlugConflictError } from './organisation-repository'
import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from './zitadel-management-client'

export function forbidden(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
}

export function notFound(message: string): AppError {
  return new AppError('NOT_FOUND', 404, message)
}

export function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message)
}

/**
 * Translates administration and identity-provider failures into the public
 * error envelope. Provider response bodies never reach the browser.
 */
export function asAdminError(error: unknown): unknown {
  if (error instanceof ZitadelConflictError) {
    return new AppError('CONFLICT', 409, 'The identity provider reported a conflict.', {
      cause: error,
    })
  }
  if (error instanceof ZitadelUnavailableError) {
    return new AppError(
      'UNAVAILABLE',
      503,
      'The identity provider is temporarily unavailable.',
      { cause: error },
    )
  }
  if (error instanceof ZitadelRejectedError) {
    return new AppError(
      'UNAVAILABLE',
      503,
      'The identity provider rejected this change.',
      { cause: error },
    )
  }
  if (error instanceof OrganisationSlugConflictError) {
    return new AppError('CONFLICT', 409, 'An organisation with this slug already exists.', {
      cause: error,
    })
  }
  if (error instanceof HospitalSlugConflictError) {
    return new AppError('CONFLICT', 409, 'A hospital with this slug already exists.', {
      cause: error,
    })
  }
  if (error instanceof DomainConflictError) {
    return new AppError('CONFLICT', 409, 'This domain is already registered.', {
      cause: error,
    })
  }
  if (error instanceof PrimaryDomainRejectedError) {
    return new AppError(
      'RULE_VIOLATION',
      422,
      'The domain must be verified for this hospital before it becomes primary.',
      { cause: error },
    )
  }
  if (error instanceof MembershipConflictError) {
    return new AppError('CONFLICT', 409, 'This person already has overlapping access.', {
      cause: error,
    })
  }
  if (error instanceof RoleAssignmentConflictError) {
    return new AppError('CONFLICT', 409, 'This role is already assigned for that period.', {
      cause: error,
    })
  }
  return error
}
