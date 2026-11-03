import { AppError } from '../shared/errors'
import { DomainConflictError, HospitalSlugConflictError } from './hospital-repository'
import { MembershipConflictError, RoleAssignmentConflictError } from './membership-admin-repository'
import { OrganisationSlugConflictError } from './organisation-repository'
import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from './zitadel-management-client'

/**
 * Translates administration and identity-provider failures into the public
 * error envelope. Provider response bodies never reach the browser.
 */
export function asAdminError(error: unknown): unknown {
  if (error instanceof ZitadelConflictError) {
    return new AppError('IDENTITY_CONFLICT', 409, 'The identity provider reported a conflict.', {
      cause: error,
    })
  }
  if (error instanceof ZitadelUnavailableError) {
    return new AppError(
      'IDENTITY_UNAVAILABLE',
      503,
      'The identity provider is temporarily unavailable.',
      { cause: error },
    )
  }
  if (error instanceof ZitadelRejectedError) {
    return new AppError(
      'IDENTITY_REJECTED',
      502,
      'The identity provider rejected this change.',
      { cause: error },
    )
  }
  if (error instanceof OrganisationSlugConflictError) {
    return new AppError('SLUG_TAKEN', 409, 'An organisation with this slug already exists.', {
      cause: error,
    })
  }
  if (error instanceof HospitalSlugConflictError) {
    return new AppError('SLUG_TAKEN', 409, 'A hospital with this slug already exists.', {
      cause: error,
    })
  }
  if (error instanceof DomainConflictError) {
    return new AppError('DOMAIN_TAKEN', 409, 'This domain is already registered.', {
      cause: error,
    })
  }
  if (error instanceof MembershipConflictError) {
    return new AppError('MEMBERSHIP_CONFLICT', 409, 'This person already has overlapping access.', {
      cause: error,
    })
  }
  if (error instanceof RoleAssignmentConflictError) {
    return new AppError('ROLE_CONFLICT', 409, 'This role is already assigned for that period.', {
      cause: error,
    })
  }
  return error
}
