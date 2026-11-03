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

export function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`database field ${key} is not text`)
  return value
}

export function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`database field ${key} is not text`)
  return value
}

export function dateField(row: Record<string, unknown>, key: string): Date {
  const value = row[key]
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  throw new Error(`database field ${key} is not a timestamp`)
}

export function nullableDateField(
  row: Record<string, unknown>,
  key: string,
): Date | null {
  const value = row[key]
  if (value === null) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  throw new Error(`database field ${key} is not a timestamp`)
}

export function bufferField(row: Record<string, unknown>, key: string): Buffer {
  const value = row[key]
  if (Buffer.isBuffer(value)) return value
  throw new Error(`database field ${key} is not bytea`)
}

export function nullableBufferField(
  row: Record<string, unknown>,
  key: string,
): Buffer | null {
  const value = row[key]
  if (value === null) return null
  if (Buffer.isBuffer(value)) return value
  throw new Error(`database field ${key} is not bytea`)
}

export function integerField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value === 'number' && Number.isInteger(value)) return value
  throw new Error(`database field ${key} is not an integer`)
}

export function nullableIntegerField(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value === 'number' && Number.isInteger(value)) return value
  throw new Error(`database field ${key} is not an integer`)
}

export function textArrayField(row: Record<string, unknown>, key: string): string[] {
  const value = row[key]
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }
  throw new Error(`database field ${key} is not a text array`)
}
