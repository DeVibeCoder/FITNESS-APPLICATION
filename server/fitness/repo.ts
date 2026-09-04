/**
 * Workout records in D1.
 *
 * Two rules hold everywhere in this file.
 *
 * The owner is always the authenticated user, passed in from the session and
 * never read from a request. Every statement carries `user_id = ?` in its
 * WHERE clause rather than checking ownership in JavaScript afterwards — a
 * row that is not yours does not come back, so there is no moment where the
 * wrong row is in hand and the check is what saves us.
 *
 * And a workout is written as one batch. D1 applies a batch atomically, so a
 * child insert that fails takes the session with it: no orphaned session, no
 * half a list of exercises. The old browser version used a Dexie transaction
 * for exactly this, and losing that guarantee in the move to SQL would be a
 * quiet regression.
 */
import type { WorkoutInput } from './validate'

export interface D1Result<T = Record<string, unknown>> {
  results?: T[]
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}
export interface D1Database {
  prepare(query: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown[]>
}

export interface WorkoutRow {
  id: string
  user_id: string
  date: string
  kind: string
  name: string
  status: string
  duration_sec: number
  calories_kcal: number
  exercise_count: number
  difficulty: string | null
  note: string | null
  logged_via: string
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

export const workoutRepo = {
  /** A user's sessions, newest first. Never anybody else's. */
  async list(db: D1Database, userId: string, limit = 100): Promise<WorkoutRow[]> {
    const { results } = await db
      .prepare(
        `SELECT * FROM workout_sessions
          WHERE user_id = ?
          ORDER BY date DESC, created_at DESC
          LIMIT ?`,
      )
      .bind(userId, Math.min(500, Math.max(1, limit)))
      .all<WorkoutRow>()
    return results ?? []
  },

  /**
   * One session with its children, or null.
   *
   * The ownership predicate is on the session query, and the children are
   * fetched by session id only after that returned something — so another
   * user's id simply finds nothing rather than leaking a row count.
   */
  async detail(db: D1Database, userId: string, sessionId: string) {
    const session = await db
      .prepare(`SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?`)
      .bind(sessionId, userId)
      .first<WorkoutRow>()
    if (!session) return null

    const [exercises, sets] = await Promise.all([
      db
        .prepare(`SELECT * FROM logged_exercises WHERE session_id = ? ORDER BY position`)
        .bind(sessionId)
        .all(),
      db.prepare(`SELECT * FROM set_results WHERE session_id = ? ORDER BY set_index`).bind(sessionId).all(),
    ])

    return { session, exercises: exercises.results ?? [], setResults: sets.results ?? [] }
  },

  /** Everything the workout screens read for their catalogue. */
  async exercises(db: D1Database) {
    const { results } = await db.prepare(`SELECT * FROM exercises ORDER BY name`).all()
    return results ?? []
  },

  /**
   * Writes a workout and its children in one atomic batch.
   *
   * Returns the session id. A failure anywhere in the batch leaves nothing
   * behind, which is what makes a partially-written workout impossible.
   */
  async create(db: D1Database, userId: string, input: WorkoutInput): Promise<string> {
    const sessionId = id('ws')
    const timestamp = now()

    const statements: D1Statement[] = [
      db
        .prepare(
          `INSERT INTO workout_sessions
             (id, user_id, date, kind, name, status, duration_sec, calories_kcal,
              exercise_count, difficulty, note, logged_via, started_at, completed_at,
              created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          sessionId,
          userId,
          input.date,
          input.kind,
          input.name,
          input.status ?? 'completed',
          input.durationSec ?? 0,
          input.caloriesKcal ?? 0,
          input.exercises?.length ?? 0,
          input.difficulty ?? null,
          input.note ?? null,
          input.loggedVia ?? 'manual',
          timestamp,
          input.status === 'active' ? null : timestamp,
          timestamp,
          timestamp,
        ),
    ]

    input.exercises?.forEach((exercise, position) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO logged_exercises
               (id, session_id, position, name, kind, sets, reps, weight_kg,
                duration_sec, distance_km, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id('lex'),
            sessionId,
            position,
            exercise.name,
            exercise.kind,
            exercise.sets ?? null,
            exercise.reps ?? null,
            exercise.weightKg ?? null,
            exercise.durationSec ?? null,
            exercise.distanceKm ?? null,
            exercise.note ?? null,
          ),
      )
    })

    input.setResults?.forEach((result) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO set_results
               (id, session_id, plan_exercise_id, set_index, reps, duration_sec,
                weight_kg, completed, skipped, completed_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id('sr'),
            sessionId,
            result.planExerciseId ?? null,
            result.setIndex,
            result.reps ?? null,
            result.durationSec ?? null,
            result.weightKg ?? null,
            result.completed === false ? 0 : 1,
            result.skipped ? 1 : 0,
            timestamp,
          ),
      )
    })

    await db.batch(statements)
    return sessionId
  },

  /**
   * Replaces a workout and its exercises wholesale, in one batch.
   *
   * An edit is somebody re-stating the list, and the lists are three or four
   * rows long — a diff would be more code than the thing it optimises. The
   * delete and the re-insert ride in the same batch, so a failure cannot
   * leave a session with its exercises removed and nothing put back.
   *
   * Deliberately writes no announcement. A workout's history in the group
   * feed is a snapshot of what was announced at the time and is not rewritten
   * when the record behind it changes.
   */
  async update(db: D1Database, userId: string, sessionId: string, input: WorkoutInput): Promise<boolean> {
    const existing = await db
      .prepare(`SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?`)
      .bind(sessionId, userId)
      .first()
    if (!existing) return false

    const timestamp = now()
    const statements: D1Statement[] = [
      db
        .prepare(
          `UPDATE workout_sessions
              SET date = ?, kind = ?, name = ?, status = ?, duration_sec = ?,
                  calories_kcal = ?, exercise_count = ?, difficulty = ?, note = ?,
                  updated_at = ?
            WHERE id = ? AND user_id = ?`,
        )
        .bind(
          input.date,
          input.kind,
          input.name,
          input.status ?? 'completed',
          input.durationSec ?? 0,
          input.caloriesKcal ?? 0,
          input.exercises?.length ?? 0,
          input.difficulty ?? null,
          input.note ?? null,
          timestamp,
          sessionId,
          userId,
        ),
      db.prepare(`DELETE FROM logged_exercises WHERE session_id = ?`).bind(sessionId),
    ]

    input.exercises?.forEach((exercise, position) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO logged_exercises
               (id, session_id, position, name, kind, sets, reps, weight_kg,
                duration_sec, distance_km, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id('lex'),
            sessionId,
            position,
            exercise.name,
            exercise.kind,
            exercise.sets ?? null,
            exercise.reps ?? null,
            exercise.weightKg ?? null,
            exercise.durationSec ?? null,
            exercise.distanceKm ?? null,
            exercise.note ?? null,
          ),
      )
    })

    await db.batch(statements)
    return true
  },

  /**
   * Deletes a session. The schema cascades its exercises and set results.
   *
   * Group announcements are deliberately untouched: they carry no reference
   * to a session and are meant to outlive it.
   */
  async remove(db: D1Database, userId: string, sessionId: string): Promise<boolean> {
    const existing = await db
      .prepare(`SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?`)
      .bind(sessionId, userId)
      .first()
    if (!existing) return false
    await db.prepare(`DELETE FROM workout_sessions WHERE id = ? AND user_id = ?`).bind(sessionId, userId).run()
    return true
  },
}
