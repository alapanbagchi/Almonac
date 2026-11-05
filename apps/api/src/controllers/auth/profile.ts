import { AppError } from '../../shared/errors'

export const MIN_NAME_LENGTH = 2
export const MAX_NAME_LENGTH = 200

/** Collapse whitespace once, then apply the one name rule both forms share. */
export function normaliseDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new AppError('INVALID_NAME', 422, 'Full name is not valid.')
  }
  return name
}
