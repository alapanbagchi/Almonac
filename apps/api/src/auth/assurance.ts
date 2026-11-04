import { AppError } from '../shared/errors'

export interface AssurancePolicy {
  readonly minimumAal: 1 | 2 | 3
  readonly maxAuthAgeSeconds?: number
  readonly requiredAmr?: readonly string[]
}

/**
 * Enforce an authentication assurance policy for one action. The policy is
 * separate from authorisation: a user can hold the permission and still need a
 * fresh or stronger authentication. Failures return 403 so the client can run a
 * step-up and retry once.
 */
export function requireAssurance(
  session: {
    readonly aal: number
    readonly amr: readonly string[]
    readonly authTime: Date
  },
  policy: AssurancePolicy,
  now: Date = new Date(),
): void {
  if (session.aal < policy.minimumAal) throw stepUpRequired()

  if (policy.maxAuthAgeSeconds !== undefined) {
    if (!Number.isInteger(policy.maxAuthAgeSeconds) || policy.maxAuthAgeSeconds < 0) {
      throw new Error('maxAuthAgeSeconds must be a non-negative integer')
    }
    const ageSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.authTime.getTime()) / 1_000),
    )
    if (ageSeconds > policy.maxAuthAgeSeconds) throw stepUpRequired()
  }

  if (
    policy.requiredAmr !== undefined &&
    !policy.requiredAmr.every((method) => session.amr.includes(method))
  ) {
    throw stepUpRequired()
  }
}

function stepUpRequired(): AppError {
  return new AppError(
    'STEP_UP_REQUIRED',
    403,
    'Stronger authentication is required.',
  )
}
