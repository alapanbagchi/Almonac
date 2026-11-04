/**
 * Database rows are untrusted input. These helpers validate the fields a
 * repository reads instead of casting a row to a TypeScript interface.
 */
export function rowRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('database row is not an object')
  }
  return value as Record<string, unknown>
}

interface Kind<T> {
  readonly label: string
  readonly check: (value: unknown) => value is T
}

const KIND = {
  string: { label: 'text', check: (value: unknown): value is string => typeof value === 'string' },
  date: {
    label: 'a timestamp',
    check: (value: unknown): value is Date => value instanceof Date && !Number.isNaN(value.getTime()),
  },
  buffer: { label: 'bytea', check: (value: unknown): value is Buffer => Buffer.isBuffer(value) },
  integer: {
    label: 'an integer',
    check: (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value),
  },
  textArray: {
    label: 'a text array',
    check: (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((item) => typeof item === 'string'),
  },
} as const satisfies Record<string, Kind<unknown>>

/** Read one validated field; an absent key fails just like a wrong type. */
export function field<T>(row: Record<string, unknown>, key: string, kind: Kind<T>): T {
  const value = row[key]
  if (!kind.check(value)) throw new Error(`database field ${key} is not ${kind.label}`)
  return value
}

export function nullableField<T>(row: Record<string, unknown>, key: string, kind: Kind<T>): T | null {
  if (row[key] === null) return null
  return field(row, key, kind)
}

export function stringField(row: Record<string, unknown>, key: string): string {
  return field(row, key, KIND.string)
}

export function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  return nullableField(row, key, KIND.string)
}

export function dateField(row: Record<string, unknown>, key: string): Date {
  return field(row, key, KIND.date)
}

export function nullableDateField(row: Record<string, unknown>, key: string): Date | null {
  return nullableField(row, key, KIND.date)
}

export function bufferField(row: Record<string, unknown>, key: string): Buffer {
  return field(row, key, KIND.buffer)
}

export function nullableBufferField(row: Record<string, unknown>, key: string): Buffer | null {
  return nullableField(row, key, KIND.buffer)
}

export function integerField(row: Record<string, unknown>, key: string): number {
  return field(row, key, KIND.integer)
}

export function nullableIntegerField(row: Record<string, unknown>, key: string): number | null {
  return nullableField(row, key, KIND.integer)
}

export function textArrayField(row: Record<string, unknown>, key: string): string[] {
  return field(row, key, KIND.textArray)
}
/** True when PostgreSQL rejected the statement with any of these SQLSTATEs. */
export function hasSqlState(error: unknown, ...codes: readonly string[]): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = Reflect.get(error, 'code') as unknown
  return typeof code === 'string' && codes.includes(code)
}
