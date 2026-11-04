import { AppError } from './errors'

/**
 * The public error envelope has one code per status. These constructors keep
 * every feature from restating the same sentence.
 */
export function forbidden(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
}

export function notFound(message: string): AppError {
  return new AppError('NOT_FOUND', 404, message)
}

export function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message)
}

export function ruleViolation(message: string): AppError {
  return new AppError('RULE_VIOLATION', 422, message)
}
