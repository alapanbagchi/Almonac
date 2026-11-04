/** Liveness only proves the process is up; it never touches a dependency. */
export function liveness() {
  return { status: 'ok' as const }
}
