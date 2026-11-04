/** An instant on the wire: every API response carries ISO 8601, never a Date. */
export function instant(value: Date): string {
  return value.toISOString()
}

export function maybeInstant(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}
