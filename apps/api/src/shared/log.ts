/** Keep only a bounded class name for logs; never log messages or codes. */
export function safeName(error: unknown, fallback = 'unknown'): string {
  const name =
    error instanceof Error && typeof error.name === 'string' ? error.name : ''
  return name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || fallback
}
