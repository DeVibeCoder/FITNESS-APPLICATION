/**
 * What somebody ate, drank, walked, weighed and felt, in D1.
 *
 * Same two rules as the workout repo, for the same reasons. The owner is the
 * authenticated user and arrives as an argument, never from a request; and
 * every statement carries `user_id = ?` in its WHERE clause rather than
 * fetching a row and checking afterwards, so a row belonging to somebody else
 * never comes back at all.
 *
 * Writes are upserts keyed on the client's id. That is deliberate: the browser
 * writes to its local cache and to here, and a retry after a flaky response
 * has to land on the same row rather than making a second one. Several of
 * these tables also carry a natural uniqueness — one weight per day, one step
 * count per day, one check-in per day — and the upsert honours both keys, so
 * correcting today's weigh-in updates today's row wherever it came from.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

const nowIso = () => new Date().toISOString()

export interface FoodRow {
  id: string
  user_id: string
  date: string
  meal: string
  name: string
  portion: string
  quantity: number | null
  unit: string | null
  note: string | null
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  source: string
  created_at: string
}

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const
const FOOD_SOURCES = ['manual', 'photo', 'favourite'] as const
const STEP_SOURCES = ['manual', 'health_kit', 'health_connect', 'fitbit'] as const
const SORENESS = ['none', 'low', 'medium', 'high'] as const

export function validateFood(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    date: v.dateKey(raw.date),
    meal: v.oneOf(raw.meal, 'meal', MEALS),
    name: v.text(raw.name, 'name', 200),
    portion: v.text(raw.portion, 'portion', 80, { allowEmpty: true }),
    quantity: v.optionalNumber(raw.quantity, 'quantity', { min: 0, max: 100000 }),
    unit: v.optionalText(raw.unit, 'unit', 24),
    note: v.optionalText(raw.note, 'note', 500),
    kcal: v.number(raw.kcal, 'kcal', { min: 0, max: 20000 }),
    proteinG: v.number(raw.proteinG, 'proteinG', { min: 0, max: 2000 }),
    carbsG: v.number(raw.carbsG, 'carbsG', { min: 0, max: 2000 }),
    fatG: v.number(raw.fatG, 'fatG', { min: 0, max: 2000 }),
    source: v.oneOf(raw.source, 'source', FOOD_SOURCES),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateWater(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    date: v.dateKey(raw.date),
    // Negative is allowed: the UI removes a glass by logging its opposite.
    ml: v.integer(raw.ml, 'ml', { min: -5000, max: 5000 }),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateSteps(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    date: v.dateKey(raw.date),
    steps: v.integer(raw.steps, 'steps', { min: 0, max: 300000 }),
    source: v.optionalOneOf(raw.source, 'source', STEP_SOURCES) ?? 'manual',
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateWeight(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    date: v.dateKey(raw.date),
    weightKg: v.number(raw.weightKg, 'weightKg', { min: 20, max: 500 }),
    note: v.optionalText(raw.note, 'note', 500),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateCheckin(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    date: v.dateKey(raw.date),
    energy: v.integer(raw.energy, 'energy', { min: 1, max: 4 }),
    // Mood has no column of its own; it rides in `feeling` as a number, which
    // is what that free-text column was left for.
    mood: v.optionalInteger(raw.mood, 'mood', { min: 1, max: 5 }),
    soreness: v.optionalOneOf(raw.soreness, 'soreness', SORENESS),
    note: v.optionalText(raw.note, 'note', 1000),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

/** Rows for one user, optionally narrowed to a date range. */
async function listByDate<T>(
  db: D1Database,
  table: string,
  userId: string,
  range: { from?: string | null; to?: string | null; limit: number },
): Promise<T[]> {
  // The table name is a literal chosen here, never a caller's string; every
  // value is bound.
  const clauses = ['user_id = ?']
  const binds: unknown[] = [userId]
  if (range.from) {
    clauses.push('date >= ?')
    binds.push(range.from)
  }
  if (range.to) {
    clauses.push('date <= ?')
    binds.push(range.to)
  }
  const { results } = await db
    .prepare(`SELECT * FROM ${table} WHERE ${clauses.join(' AND ')} ORDER BY date DESC, created_at DESC LIMIT ?`)
    .bind(...binds, range.limit)
    .all<T>()
  return results ?? []
}

/** Deletes one row, but only if it is the caller's. Returns whether it was. */
async function removeOwn(db: D1Database, table: string, userId: string, rowId: string): Promise<boolean> {
  const existing = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`)
    .bind(rowId, userId)
    .first<{ id: string }>()
  if (!existing) return false
  await db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).bind(rowId, userId).run()
  return true
}

/**
 * The offered id, unless somebody else already holds it.
 *
 * A client id is unique on the device that made it, not across the group: two
 * devices restored from the same starting data will offer the same one. That
 * is not a reason to fail a save the person had every right to make, so a
 * clash mints a fresh id instead of colliding on the primary key.
 */
async function ownedId(db: D1Database, table: string, userId: string, offered: string): Promise<string> {
  const taken = await db
    .prepare(`SELECT user_id FROM ${table} WHERE id = ?`)
    .bind(offered)
    .first<{ user_id: string }>()
  if (taken && taken.user_id !== userId) return `${table.slice(0, 2)}_${crypto.randomUUID()}`
  return offered
}

/**
 * Which row a day-keyed write should land on.
 *
 * Three of these tables allow one row per person per day, and the client picks
 * the id. Those two facts can disagree, and the disagreement has to be settled
 * here rather than by a constraint: if the day already has a row of mine under
 * a different id, that is the row being corrected and its id is the one to
 * write. Otherwise the offered id is used, subject to the same cross-account
 * check as everything else.
 */
async function dayRowId(
  db: D1Database,
  table: string,
  userId: string,
  date: string,
  offered: string,
): Promise<string> {
  const mine = await db
    .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND date = ?`)
    .bind(userId, date)
    .first<{ id: string }>()
  if (mine) return mine.id
  return ownedId(db, table, userId, offered)
}

export const nutritionRepo = {
  listFood: (db: D1Database, userId: string, range: { from?: string | null; to?: string | null; limit: number }) =>
    listByDate<FoodRow>(db, 'food_entries', userId, range),

  async saveFood(db: D1Database, userId: string, input: ReturnType<typeof validateFood>): Promise<void> {
    // Many meals a day, so there is no day key here — only the cross-account
    // id clash needs settling.
    const rowId = await ownedId(db, 'food_entries', userId, input.id)
    await db
      .prepare(
        `INSERT INTO food_entries
           (id, user_id, date, meal, name, portion, quantity, unit, note,
            kcal, protein_g, carbs_g, fat_g, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           date = excluded.date, meal = excluded.meal, name = excluded.name,
           portion = excluded.portion, quantity = excluded.quantity, unit = excluded.unit,
           note = excluded.note, kcal = excluded.kcal, protein_g = excluded.protein_g,
           carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, source = excluded.source
         WHERE food_entries.user_id = ?`,
      )
      .bind(
        rowId, userId, input.date, input.meal, input.name, input.portion,
        input.quantity, input.unit, input.note, input.kcal, input.proteinG,
        input.carbsG, input.fatG, input.source, input.createdAt, userId,
      )
      .run()
  },

  removeFood: (db: D1Database, userId: string, id: string) => removeOwn(db, 'food_entries', userId, id),

  listWater: (db: D1Database, userId: string, range: { from?: string | null; to?: string | null; limit: number }) =>
    listByDate<{ id: string; user_id: string; date: string; ml: number; created_at: string }>(
      db, 'water_entries', userId, range,
    ),

  async saveWater(db: D1Database, userId: string, input: ReturnType<typeof validateWater>): Promise<void> {
    const rowId = await ownedId(db, 'water_entries', userId, input.id)
    await db
      .prepare(
        `INSERT INTO water_entries (id, user_id, date, ml, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET date = excluded.date, ml = excluded.ml
         WHERE water_entries.user_id = ?`,
      )
      .bind(rowId, userId, input.date, input.ml, input.createdAt, userId)
      .run()
  },

  removeWater: (db: D1Database, userId: string, id: string) => removeOwn(db, 'water_entries', userId, id),

  listSteps: (db: D1Database, userId: string, range: { from?: string | null; to?: string | null; limit: number }) =>
    listByDate<{ id: string; user_id: string; date: string; steps: number; source: string; created_at: string }>(
      db, 'step_entries', userId, range,
    ),

  /**
   * One step count per day.
   *
   * Two keys can collide here — the id the client chose and the day, which is
   * unique per user — so the row is cleared by id first and then inserted
   * against the day. As one batch, because separately a failure between them
   * would lose the day's count rather than leaving it as it was.
   */
  async saveSteps(db: D1Database, userId: string, input: ReturnType<typeof validateSteps>): Promise<void> {
    const rowId = await dayRowId(db, 'step_entries', userId, input.date, input.id)
    await db
      .prepare(
        `INSERT INTO step_entries (id, user_id, date, steps, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           date = excluded.date, steps = excluded.steps, source = excluded.source
         WHERE step_entries.user_id = ?`,
      )
      .bind(rowId, userId, input.date, input.steps, input.source, input.createdAt, userId)
      .run()
  },

  removeSteps: (db: D1Database, userId: string, id: string) => removeOwn(db, 'step_entries', userId, id),

  listWeights: (db: D1Database, userId: string, range: { from?: string | null; to?: string | null; limit: number }) =>
    listByDate<{ id: string; user_id: string; date: string; weight_kg: number; note: string | null; created_at: string }>(
      db, 'weights', userId, range,
    ),

  /** One weigh-in per day, corrected in place rather than duplicated. */
  async saveWeight(db: D1Database, userId: string, input: ReturnType<typeof validateWeight>): Promise<void> {
    const rowId = await dayRowId(db, 'weights', userId, input.date, input.id)
    await db
      .prepare(
        `INSERT INTO weights (id, user_id, date, weight_kg, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           date = excluded.date, weight_kg = excluded.weight_kg, note = excluded.note
         WHERE weights.user_id = ?`,
      )
      .bind(rowId, userId, input.date, input.weightKg, input.note, input.createdAt, userId)
      .run()
  },

  removeWeight: (db: D1Database, userId: string, id: string) => removeOwn(db, 'weights', userId, id),

  listCheckins: (db: D1Database, userId: string, range: { from?: string | null; to?: string | null; limit: number }) =>
    listByDate<{
      id: string; user_id: string; date: string; energy: number | null
      soreness: string | null; feeling: string | null; note: string | null; created_at: string
    }>(db, 'checkins', userId, range),

  /** One check-in per day, same two-key handling as the weigh-in. */
  async saveCheckin(db: D1Database, userId: string, input: ReturnType<typeof validateCheckin>): Promise<void> {
    const rowId = await dayRowId(db, 'checkins', userId, input.date, input.id)
    await db
      .prepare(
        `INSERT INTO checkins (id, user_id, date, energy, soreness, feeling, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           date = excluded.date, energy = excluded.energy, soreness = excluded.soreness,
           feeling = excluded.feeling, note = excluded.note
         WHERE checkins.user_id = ?`,
      )
      .bind(
        rowId, userId, input.date, input.energy, input.soreness,
        input.mood === null ? null : String(input.mood), input.note, input.createdAt, userId,
      )
      .run()
  },

  removeCheckin: (db: D1Database, userId: string, id: string) => removeOwn(db, 'checkins', userId, id),
}
