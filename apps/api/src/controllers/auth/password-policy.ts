import { AppError } from '../../shared/errors'

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 72

const UPPER = /[A-Z]/
const LOWER = /[a-z]/
const DIGIT = /[0-9]/
const SYMBOL = /[^A-Za-z0-9]/

/** One policy for sign-up and invitation claim, so the two cannot drift. */
export function isStrongPassword(value: string): boolean {
  return (
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH &&
    UPPER.test(value) &&
    LOWER.test(value) &&
    DIGIT.test(value) &&
    SYMBOL.test(value)
  )
}

export function assertStrongPassword(value: string): void {
  if (isStrongPassword(value)) return
  throw new AppError(
    'INVALID_PASSWORD',
    422,
    'Password must be 8 to 72 characters and include upper case, lower case, a number and a symbol.',
  )
}
