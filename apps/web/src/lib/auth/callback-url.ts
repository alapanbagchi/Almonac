const LOGIN_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * Read the state that the identity provider returned in its callback. The
 * browser must hold the same value in the login cookie before the callback
 * is accepted, so a link cannot sign a victim into the attacker account.
 */
export function readCallback(
  value: string,
  publicOrigin: string,
): { url: string; state: string } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== publicOrigin || url.pathname !== "/api/auth/callback") return null

  const state = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  if (state === null || code === null) return null
  if (!LOGIN_STATE_PATTERN.test(state) || code.length < 1 || code.length > 4096) return null

  return { url: url.toString(), state }
}
