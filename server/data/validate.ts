/**
 * What a request is allowed to contain, checked before SQLite sees it.
 *
 * Two rules run through every function here.
 *
 * Nothing about *who* is ever validated, because nothing about who is ever
 * accepted. A `userId`, a `role`, an `ownerId` in a body is not read by any
 * caller of these validators — the owner comes from the session cookie, and a
 * forged field changes nothing rather than being an error worth reporting.
 *
 * And a value that fails is refused by name. SQLite would accept most of this
 * happily — it will store the string 'banana' in a REAL column — so a CHECK
 * constraint is the last line, not the first. Saying which field was wrong is
 * what lets the client fix it; saying what the database thought of it would
 * describe the schema to somebody who should not have it.
 */

export class InvalidInput extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'InvalidInput'
    this.field = field
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function body(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new InvalidInput('body', 'Expected an object.')
  return value
}

/**
 * An identifier the client chose.
 *
 * The client generates ids so a row can exist in the local cache and in D1
 * under one identity — without that, every write would need a round trip
 * before anything could reference it. The format is checked because these are
 * concatenated into no SQL anywhere, but they are returned to other clients,
 * and an id is not a place to smuggle a payload.
 */
export function id(value: unknown, field = 'id'): string {
  if (typeof value !== 'string') throw new InvalidInput(field, 'Expected an id.')
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) {
    throw new InvalidInput(field, 'That is not a valid id.')
  }
  return trimmed
}

/**
 * A short list of ids, or nothing.
 *
 * Bounded on purpose: the only caller is a post's pictures, and a body that
 * arrives with four thousand ids is not a post.
 */
export function optionalIdList(value: unknown, field: string, max: number): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new InvalidInput(field, 'That should be a list.')
  if (value.length > max) throw new InvalidInput(field, `No more than ${max}.`)
  return value.map((one) => id(one, field))
}

export function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return id(value, field)
}

/** 'YYYY-MM-DD', and a date that actually exists. */
export function dateKey(value: unknown, field = 'date'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidInput(field, 'Expected a date as YYYY-MM-DD.')
  }
  const [y, m, d] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    throw new InvalidInput(field, 'That date does not exist.')
  }
  return value
}

export function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new InvalidInput(field, 'Expected an ISO timestamp.')
  }
  return value
}

export function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return timestamp(value, field)
}

export function text(value: unknown, field: string, max: number, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string') throw new InvalidInput(field, 'Expected text.')
  const trimmed = value.trim()
  if (!allowEmpty && !trimmed) throw new InvalidInput(field, 'This cannot be empty.')
  if (trimmed.length > max) throw new InvalidInput(field, `Keep this under ${max} characters.`)
  return trimmed
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return text(value, field, max)
}

export function number(value: unknown, field: string, { min = 0, max = 1e9 } = {}): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new InvalidInput(field, 'Expected a number.')
  }
  if (parsed < min || parsed > max) {
    throw new InvalidInput(field, `Expected a number between ${min} and ${max}.`)
  }
  return parsed
}

export function optionalNumber(
  value: unknown,
  field: string,
  bounds?: { min?: number; max?: number },
): number | null {
  if (value === undefined || value === null || value === '') return null
  return number(value, field, bounds)
}

export function integer(value: unknown, field: string, bounds?: { min?: number; max?: number }): number {
  const parsed = number(value, field, bounds)
  if (!Number.isInteger(parsed)) throw new InvalidInput(field, 'Expected a whole number.')
  return parsed
}

export function optionalInteger(
  value: unknown,
  field: string,
  bounds?: { min?: number; max?: number },
): number | null {
  if (value === undefined || value === null || value === '') return null
  return integer(value, field, bounds)
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new InvalidInput(field, `Expected one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

export function optionalOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null || value === '') return null
  return oneOf(value, field, allowed)
}

export function boolean(value: unknown, field: string, fallback?: boolean): boolean {
  if (value === undefined || value === null) {
    if (fallback === undefined) throw new InvalidInput(field, 'Expected true or false.')
    return fallback
  }
  if (typeof value !== 'boolean') throw new InvalidInput(field, 'Expected true or false.')
  return value
}

/**
 * A small JSON blob stored as text — a story background, an update's meta.
 *
 * Capped because these columns exist to carry a handful of fields, and a
 * megabyte of JSON in a TEXT column is how a row store becomes a file store
 * by accident. Media never travels this way; it is referenced by id.
 */
export function jsonBlob(value: unknown, field: string, max = 2000): string | null {
  if (value === undefined || value === null) return null
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new InvalidInput(field, 'That could not be stored.')
  }
  if (encoded.length > max) throw new InvalidInput(field, `Keep this under ${max} characters.`)
  return encoded
}

/** A read limit from a query string, clamped rather than trusted. */
export function limit(value: string | null, fallback = 100, max = 500): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}
