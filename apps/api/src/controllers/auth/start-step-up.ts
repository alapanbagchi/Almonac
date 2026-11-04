import type { AuthDependencies, LoginRequestContext } from './dependencies'
import { beginLoginAttempt, type LoginStartDto } from './start-login'

/**
 * Start a step-up attempt for an already-authenticated user. The provider must
 * re-authenticate the user even when its own session is still valid.
 */
export async function startStepUp(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  userId: string,
  returnTo: unknown,
): Promise<LoginStartDto> {
  return beginLoginAttempt(dependencies, context, returnTo, userId)
}
