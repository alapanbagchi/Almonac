/**
 * The global error plugin derives a request ID, but its type does not cross
 * plugin boundaries. Read it at runtime and mint one only if it is absent.
 */
export function requestIdOf(context: object): string {
  const value: unknown = Reflect.get(context, 'requestId')
  return typeof value === 'string' && value.length > 0 ? value : crypto.randomUUID()
}
