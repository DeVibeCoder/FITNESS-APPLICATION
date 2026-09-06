/**
 * The rest of what a person owns: measurements, the plan they are following,
 * the sets they actually performed, the week's challenge, and the videos the
 * group keeps.
 *
 * Two of these are not like the others, and the difference is written into
 * which statements carry `user_id = ?`.
 *
 * Measurements, enrollments and set results are private. Every read and write
 * is filtered by the authenticated user, and a row belonging to somebody else
 * does not come back at all.
 *
 * The weekly challenge and the motivation videos are the group's. Anyone
 * approved may read them, and the week's challenge is created by whoever opens
 * the app first on a Sunday — which is why creating it is idempotent on
 * `week_start` rather than a privilege. A video may only be edited or removed
 * by the person who added it.
 *
 * Set results hang off a workout session, so ownership is inherited rather
 * than duplicated: every statement joins to `workout_sessions` and filters on
 * that session's owner. Storing a `user_id` on a set as well would be a second
 * copy of the same fact, free to disagree with the first.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'
import { GROUP_ID } from './chatRepo'

const nowIso = () => new Date().toISOString()

const METRICS = ['steps', 'workouts', 'checkins', 'water', 'nutrition'] as const
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const PROVIDERS = ['youtube', 'vimeo', 'other'] as const

export function validateMeasurement(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    date: v.dateKey(raw.date),
    waistCm: v.optionalNumber(raw.waistCm, 'waistCm', { min: 20, max: 300 }),
    chestCm: v.optionalNumber(raw.chestCm, 'chestCm', { min: 20, max: 300 }),
    hipsCm: v.optionalNumber(raw.hipsCm, 'hipsCm', { min: 20, max: 300 }),
    armCm: v.optionalNumber(raw.armCm, 'armCm', { min: 10, max: 150 }),
    thighCm: v.optionalNumber(raw.thighCm, 'thighCm', { min: 10, max: 200 }),
    bodyFatPct: v.optionalNumber(raw.bodyFatPct, 'bodyFatPct', { min: 1, max: 80 }),
    note: v.optionalText(raw.note, 'note', 500),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateEnrollment(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    planId: v.id(raw.planId, 'planId'),
    startDate: v.dateKey(raw.startDate, 'startDate'),
    active: v.boolean(raw.active, 'active', true),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateSetResult(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    sessionId: v.id(raw.sessionId, 'sessionId'),
    workoutExerciseId: v.id(raw.workoutExerciseId, 'workoutExerciseId'),
    setIndex: v.integer(raw.setIndex, 'setIndex', { min: 0, max: 200 }),
    reps: v.optionalInteger(raw.reps, 'reps', { min: 0, max: 1000 }),
    durationSec: v.optionalInteger(raw.durationSec, 'durationSec', { min: 0, max: 86400 }),
    weightKg: v.optionalNumber(raw.weightKg, 'weightKg', { min: 0, max: 1000 }),
    completed: v.boolean(raw.completed, 'completed', true),
    skipped: v.boolean(raw.skipped, 'skipped', false),
    completedAt: v.optionalTimestamp(raw.completedAt, 'completedAt'),
  }
}

export function validateChallenge(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    weekStart: v.dateKey(raw.weekStart, 'weekStart'),
    title: v.text(raw.title, 'title', 200),
    blurb: v.optionalText(raw.blurb, 'blurb', 500),
    metric: v.oneOf(raw.metric, 'metric', METRICS),
    target: v.number(raw.target, 'target', { min: 0, max: 10_000_000 }),
    perMember: v.boolean(raw.perMember, 'perMember', false),
    unit: v.optionalText(raw.unit, 'unit', 40),
    icon: v.optionalText(raw.icon, 'icon', 40),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateVideo(input: unknown) {
  const raw = v.body(input)
  const url = v.text(raw.url, 'url', 800)
  // A link to somebody else's server, and only over https. Never a payload.
  if (!/^https:\/\//i.test(url)) throw new v.InvalidInput('url', 'Expected an https link.')
  return {
    id: v.id(raw.id),
    title: v.text(raw.title, 'title', 200),
    url,
    provider: v.optionalOneOf(raw.provider, 'provider', PROVIDERS) ?? 'other',
    quote: v.optionalText(raw.quote, 'quote', 500),
    thumbnailUrl: v.optionalText(raw.thumbnailUrl, 'thumbnailUrl', 800),
    durationSec: v.optionalInteger(raw.durationSec, 'durationSec', { min: 0, max: 86400 }),
    isActive: v.boolean(raw.isActive, 'isActive', true),
    rotationOrder: v.optionalInteger(raw.rotationOrder, 'rotationOrder', { min: 0, max: 10000 }),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validatePlan(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    name: v.text(raw.name, 'name', 200),
    description: v.text(raw.description, 'description', 1000, { allowEmpty: true }),
    level: v.optionalOneOf(raw.level, 'level', LEVELS),
    totalDays: v.integer(raw.totalDays, 'totalDays', { min: 1, max: 365 }),
    focus: v.jsonBlob(raw.focus, 'focus', 500) ?? '[]',
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

async function removeOwn(db: D1Database, table: string, column: string, userId: string, rowId: string) {
  const existing = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND ${column} = ?`)
    .bind(rowId, userId)
    .first<{ id: string }>()
  if (!existing) return false
  await db.prepare(`DELETE FROM ${table} WHERE id = ? AND ${column} = ?`).bind(rowId, userId).run()
  return true
}

export const trainingRepo = {
  // --- Measurements: private ------------------------------------------------
  async listMeasurements(db: D1Database, userId: string, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM measurements WHERE user_id = ? ORDER BY date DESC LIMIT ?')
      .bind(userId, limit)
      .all()
    return results ?? []
  },

  /** One set of measurements per day, corrected in place. */
  async saveMeasurement(db: D1Database, userId: string, input: ReturnType<typeof validateMeasurement>) {
    const mine = await db
      .prepare('SELECT id FROM measurements WHERE user_id = ? AND date = ?')
      .bind(userId, input.date)
      .first<{ id: string }>()
    const rowId = mine?.id ?? input.id
    await db
      .prepare(
        `INSERT INTO measurements
           (id, user_id, date, chest_cm, waist_cm, hips_cm, arm_cm, thigh_cm, body_fat_pct, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           date = excluded.date, chest_cm = excluded.chest_cm, waist_cm = excluded.waist_cm,
           hips_cm = excluded.hips_cm, arm_cm = excluded.arm_cm, thigh_cm = excluded.thigh_cm,
           body_fat_pct = excluded.body_fat_pct, note = excluded.note
         WHERE measurements.user_id = ?`,
      )
      .bind(
        rowId, userId, input.date, input.chestCm, input.waistCm, input.hipsCm,
        input.armCm, input.thighCm, input.bodyFatPct, input.note, input.createdAt, userId,
      )
      .run()
  },

  removeMeasurement: (db: D1Database, userId: string, id: string) =>
    removeOwn(db, 'measurements', 'user_id', userId, id),

  // --- Plans: the catalogue is shared, the enrollment is yours --------------
  async listPlans(db: D1Database, limit: number) {
    const { results } = await db.prepare('SELECT * FROM plans ORDER BY name ASC LIMIT ?').bind(limit).all()
    return results ?? []
  },

  async planDays(db: D1Database, planId: string) {
    const { results } = await db
      .prepare('SELECT * FROM plan_days WHERE plan_id = ? ORDER BY day_number ASC')
      .bind(planId)
      .all()
    return results ?? []
  },

  async planExercises(db: D1Database, planId: string) {
    const { results } = await db
      .prepare(
        `SELECT pe.* FROM plan_exercises pe
           JOIN plan_days pd ON pd.id = pe.plan_day_id
          WHERE pd.plan_id = ?
          ORDER BY pd.day_number ASC, pe.position ASC`,
      )
      .bind(planId)
      .all()
    return results ?? []
  },

  async listEnrollments(db: D1Database, userId: string) {
    const { results } = await db
      .prepare('SELECT * FROM plan_enrollments WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all()
    return results ?? []
  },

  /**
   * Starting a plan. Refused if the plan is not one the server knows — a plan
   * id from a device's own catalogue is not something to create a row against.
   */
  async saveEnrollment(db: D1Database, userId: string, input: ReturnType<typeof validateEnrollment>) {
    const plan = await db.prepare('SELECT id FROM plans WHERE id = ?').bind(input.planId).first<{ id: string }>()
    if (!plan) return false
    await db
      .prepare(
        `INSERT INTO plan_enrollments (id, user_id, plan_id, start_date, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           plan_id = excluded.plan_id, start_date = excluded.start_date, active = excluded.active
         WHERE plan_enrollments.user_id = ?`,
      )
      .bind(input.id, userId, input.planId, input.startDate, input.active ? 1 : 0, input.createdAt, userId)
      .run()
    return true
  },

  removeEnrollment: (db: D1Database, userId: string, id: string) =>
    removeOwn(db, 'plan_enrollments', 'user_id', userId, id),

  // --- Set results: ownership inherited from the session -------------------
  async listSetResults(db: D1Database, userId: string, limit: number) {
    const { results } = await db
      .prepare(
        `SELECT sr.* FROM set_results sr
           JOIN workout_sessions ws ON ws.id = sr.session_id
          WHERE ws.user_id = ?
          ORDER BY sr.session_id, sr.set_index
          LIMIT ?`,
      )
      .bind(userId, limit)
      .all()
    return results ?? []
  },

  /**
   * Records one performed set.
   *
   * The session is checked first, and checked as the caller's: without that,
   * anybody could append sets to somebody else's workout, and the sets would
   * be perfectly valid rows on a session that was never theirs.
   */
  async saveSetResult(db: D1Database, userId: string, input: ReturnType<typeof validateSetResult>) {
    const session = await db
      .prepare('SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?')
      .bind(input.sessionId, userId)
      .first<{ id: string }>()
    if (!session) return false

    /*
     * A set is identified twice over: by the id the client chose, and by where
     * it sits — this session, this exercise, this set number. Correcting the
     * third set of an exercise has to land on the row that already is the
     * third set, whatever id it arrived under, or the unique index refuses a
     * perfectly ordinary correction.
     */
    const placed = await db
      .prepare(
        'SELECT id FROM set_results WHERE session_id = ? AND plan_exercise_id = ? AND set_index = ?',
      )
      .bind(input.sessionId, input.workoutExerciseId, input.setIndex)
      .first<{ id: string }>()
    const rowId = placed?.id ?? input.id

    await db
      .prepare(
        `INSERT INTO set_results
           (id, session_id, plan_exercise_id, set_index, reps, duration_sec, weight_kg, completed, skipped, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           reps = excluded.reps, duration_sec = excluded.duration_sec, weight_kg = excluded.weight_kg,
           completed = excluded.completed, skipped = excluded.skipped, completed_at = excluded.completed_at`,
      )
      .bind(
        rowId, input.sessionId, input.workoutExerciseId, input.setIndex,
        input.reps, input.durationSec, input.weightKg,
        input.completed ? 1 : 0, input.skipped ? 1 : 0, input.completedAt,
      )
      .run()
    return true
  },

  // --- The week's challenge: the group's ------------------------------------
  async listChallenges(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM challenges WHERE group_id = ? ORDER BY week_start DESC LIMIT ?')
      .bind(GROUP_ID, limit)
      .all()
    return results ?? []
  },

  /**
   * Creates the week if it is not there yet, and answers with whatever the
   * week's challenge actually is.
   *
   * Idempotent on the week rather than guarded by a permission: whoever opens
   * the app first on a Sunday creates it, and everybody after that finds it.
   * The unique index on (group_id, week_start) is what makes two people
   * opening it at once produce one challenge instead of two.
   */
  async ensureChallenge(db: D1Database, input: ReturnType<typeof validateChallenge>) {
    await db
      .prepare(
        `INSERT INTO challenges (id, group_id, week_start, metric, target, title, blurb, per_member, unit, icon, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id, week_start) DO NOTHING`,
      )
      .bind(
        input.id, GROUP_ID, input.weekStart, input.metric, input.target, input.title,
        input.blurb, input.perMember ? 1 : 0, input.unit, input.icon, input.createdAt,
      )
      .run()
    return db
      .prepare('SELECT * FROM challenges WHERE group_id = ? AND week_start = ?')
      .bind(GROUP_ID, input.weekStart)
      .first()
  },

  async listParticipants(db: D1Database, limit: number) {
    const { results } = await db
      .prepare(
        `SELECT cp.* FROM challenge_participants cp
           JOIN challenges c ON c.id = cp.challenge_id
          WHERE c.group_id = ?
          ORDER BY cp.updated_at DESC LIMIT ?`,
      )
      .bind(GROUP_ID, limit)
      .all()
    return results ?? []
  },

  /**
   * Taking part, or sitting the week out. Only ever for yourself — there is no
   * parameter for whose participation this is, so there is no way to set
   * somebody else's.
   */
  async setParticipation(
    db: D1Database,
    userId: string,
    input: { id: string; challengeId: string; takingPart: boolean; joinedAt: string; leftAt: string | null },
  ) {
    const challenge = await db
      .prepare('SELECT id FROM challenges WHERE id = ? AND group_id = ?')
      .bind(input.challengeId, GROUP_ID)
      .first<{ id: string }>()
    if (!challenge) return false
    await db
      .prepare(
        `INSERT INTO challenge_participants (id, challenge_id, user_id, taking_part, joined_at, left_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(challenge_id, user_id) DO UPDATE SET
           taking_part = excluded.taking_part, joined_at = excluded.joined_at,
           left_at = excluded.left_at, updated_at = excluded.updated_at`,
      )
      .bind(
        input.id, input.challengeId, userId, input.takingPart ? 1 : 0,
        input.joinedAt, input.leftAt, nowIso(),
      )
      .run()
    return true
  },

  // --- Motivation videos: the group's, edited by whoever added them ---------
  async listVideos(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM motivation_videos ORDER BY rotation_order ASC, created_at ASC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  async saveVideo(db: D1Database, userId: string, input: ReturnType<typeof validateVideo>) {
    await db
      .prepare(
        `INSERT INTO motivation_videos
           (id, added_by, title, url, note, provider, thumbnail_url, duration_sec, is_active, rotation_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, url = excluded.url, note = excluded.note,
           provider = excluded.provider, thumbnail_url = excluded.thumbnail_url,
           duration_sec = excluded.duration_sec, is_active = excluded.is_active,
           rotation_order = excluded.rotation_order
         WHERE motivation_videos.added_by = ?`,
      )
      .bind(
        input.id, userId, input.title, input.url, input.quote, input.provider,
        input.thumbnailUrl, input.durationSec, input.isActive ? 1 : 0,
        input.rotationOrder, input.createdAt, userId,
      )
      .run()
  },

  removeVideo: (db: D1Database, userId: string, id: string) =>
    removeOwn(db, 'motivation_videos', 'added_by', userId, id),
}
