const MAX_RETURN_TO_LENGTH = 2_048
const ENCODED_UNSAFE = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i
// Deliberately matches control characters: they never belong in a browser path.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/**
 * Accept only an internal path. A return target must never become an open
 * redirect or a protocol-relative URL such as //attacker.example.
 */
export function normaliseReturnTo(value: unknown, fallback = '/'): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new InvalidReturnToError()

  const target = value.trim()
  if (
    target.length === 0 ||
    target.length > MAX_RETURN_TO_LENGTH ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\') ||
    CONTROL_CHARACTER.test(target) ||
    ENCODED_UNSAFE.test(target)
  ) {
    throw new InvalidReturnToError()
  }

  return target
}

export class InvalidReturnToError extends Error {
  constructor() {
    super('returnTo must be an internal path')
    this.name = 'InvalidReturnToError'
  }
}
