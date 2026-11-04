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

type FieldCheck<T> = (value: unknown) => value is T

function fieldValue<T>(
  row: Record<string, unknown>,
  key: string,
  label: string,
  check: FieldCheck<T>,
): T {
  const value = row[key]
  if (!check(value)) throw new Error(`database field ${key} is not ${label}`)
  return value
}

function nullableFieldValue<T>(
  row: Record<string, unknown>,
  key: string,
  label: string,
  check: FieldCheck<T>,
): T | null {
  const value = row[key]
  if (value === null) return null
  if (!check(value)) throw new Error(`database field ${key} is not ${label}`)
  return value
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime())
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)
const isTextArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

export function stringField(row: Record<string, unknown>, key: string): string {
  return fieldValue(row, key, 'text', isString)
}

export function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  return nullableFieldValue(row, key, 'text', isString)
}

export function dateField(row: Record<string, unknown>, key: string): Date {
  return fieldValue(row, key, 'a timestamp', isDate)
}

export function nullableDateField(
  row: Record<string, unknown>,
  key: string,
): Date | null {
  return nullableFieldValue(row, key, 'a timestamp', isDate)
}

export function bufferField(row: Record<string, unknown>, key: string): Buffer {
  return fieldValue(row, key, 'bytea', (value) => Buffer.isBuffer(value))
}

export function nullableBufferField(
  row: Record<string, unknown>,
  key: string,
): Buffer | null {
  return nullableFieldValue(row, key, 'bytea', (value) => Buffer.isBuffer(value))
}

export function integerField(row: Record<string, unknown>, key: string): number {
  return fieldValue(row, key, 'an integer', isInteger)
}

export function nullableIntegerField(
  row: Record<string, unknown>,
  key: string,
): number | null {
  return nullableFieldValue(row, key, 'an integer', isInteger)
}

export function textArrayField(row: Record<string, unknown>, key: string): string[] {
  return fieldValue(row, key, 'a text array', isTextArray)
}
