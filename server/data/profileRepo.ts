/**
 * The caller's own profile, and the group's roster.
 *
 * The profile is the one place where a write could plausibly change *who* the
 * caller is, so the set of writable columns is a fixed list in this file. Not
 * a filter over what arrived, not "everything except a deny-list": a column
 * that is not named here cannot be written through this route no matter what
 * a body contains. `role` and `status` are the reason — an account that could
 * edit its own status could approve itself.
 *
 * The roster is what every screen needs to draw somebody else's name and
 * avatar next to their post. It returns display fields only: no email, no
 * status, no role, nothing about how anybody signs in.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

const nowIso = () => new Date().toISOString()

/*
 * These mirror the unions in src/models exactly. Writing them from memory is
 * how a perfectly ordinary profile save — goal "general_fitness", which the
 * form offers — came back a 400 from the deployed site while every local test
 * passed. See scripts/check-unions.ts, which now compares the two.
 */
const GOALS = [
  'lose_weight', 'maintain', 'gain_weight', 'build_muscle', 'improve_fitness', 'general_fitness',
] as const
const ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const
const UNITS = ['metric', 'imperial'] as const
const SEXES = ['male', 'female'] as const

/**
 * Every column this route may write, and how each one is checked.
 *
 * Adding a row here is the deliberate act of making a field editable. There
 * is no path that writes a column absent from this table.
 */
const WRITABLE: Record<string, { column: string; read: (value: unknown) => unknown }> = {
  name: { column: 'name', read: (x) => v.text(x, 'name', 80) },
  handle: { column: 'handle', read: (x) => v.text(x, 'handle', 40) },
  avatarColor: { column: 'avatar_color', read: (x) => v.text(x, 'avatarColor', 24) },
  avatarMediaId: { column: 'avatar_media_id', read: (x) => v.optionalId(x, 'avatarMediaId') },
  birthDate: { column: 'birth_date', read: (x) => (x === null ? null : v.dateKey(x, 'birthDate')) },
  sex: { column: 'sex', read: (x) => v.optionalOneOf(x, 'sex', SEXES) },
  heightCm: { column: 'height_cm', read: (x) => v.optionalNumber(x, 'heightCm', { min: 50, max: 260 }) },
  startWeightKg: { column: 'start_weight_kg', read: (x) => v.optionalNumber(x, 'startWeightKg', { min: 20, max: 500 }) },
  targetWeightKg: { column: 'target_weight_kg', read: (x) => v.optionalNumber(x, 'targetWeightKg', { min: 20, max: 500 }) },
  goal: { column: 'goal', read: (x) => v.optionalOneOf(x, 'goal', GOALS) },
  activityLevel: { column: 'activity_level', read: (x) => v.optionalOneOf(x, 'activityLevel', ACTIVITY) },
  calorieTargetOverride: {
    column: 'calorie_target_override',
    read: (x) => v.optionalInteger(x, 'calorieTargetOverride', { min: 800, max: 8000 }),
  },
  stepGoal: { column: 'step_goal', read: (x) => v.integer(x, 'stepGoal', { min: 0, max: 100000 }) },
  waterGoalL: { column: 'water_goal_l', read: (x) => v.number(x, 'waterGoalL', { min: 0, max: 20 }) },
  workoutsPerWeekGoal: {
    column: 'workouts_per_week_goal',
    read: (x) => v.integer(x, 'workoutsPerWeekGoal', { min: 0, max: 21 }),
  },
  weighInDay: { column: 'weigh_in_day', read: (x) => v.integer(x, 'weighInDay', { min: 0, max: 6 }) },
  units: { column: 'units', read: (x) => v.oneOf(x, 'units', UNITS) },
  workoutApps: { column: 'workout_apps', read: (x) => v.jsonBlob(x, 'workoutApps', 500) ?? '[]' },
  onboardedAt: { column: 'onboarded_at', read: (x) => v.optionalTimestamp(x, 'onboardedAt') },
}

export const profileRepo = {
  /** The caller's own record, in full. */
  async own(db: D1Database, userId: string) {
    return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first()
  },

  /**
   * Applies only the recognised fields, and refuses a body that recognises
   * none — an update that changes nothing is far more likely a client bug
   * than an intention.
   */
  async update(db: D1Database, userId: string, input: unknown) {
    const raw = v.body(input)
    const columns: string[] = []
    const binds: unknown[] = []
    for (const [key, spec] of Object.entries(WRITABLE)) {
      if (!(key in raw)) continue
      columns.push(`${spec.column} = ?`)
      binds.push(spec.read(raw[key]))
    }
    if (columns.length === 0) {
      throw new v.InvalidInput('profile', 'Nothing here can be changed.')
    }
    await db
      .prepare(`UPDATE users SET ${columns.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, nowIso(), userId)
      .run()
    return this.own(db, userId)
  },

  /**
   * Everyone in the group, as a name and a colour. Nothing more.
   *
   * Administrators are not in it, for anybody but an administrator.
   *
   * An admin on this application is not a participant: they approve people and
   * moderate accounts, and they do not train, post or weigh in. Listing them
   * beside the people who do would put a name in the group that never appears
   * anywhere else — no workouts, no posts, no weigh-ins — which reads as
   * either a broken account or a silent watcher, and is the second of those.
   *
   * So the group sees the group. `forAdmin` is passed by the route from the
   * session's own role, never from anything a caller sends; a member asking
   * for the roster gets members whatever they put in the request.
   */
  async roster(db: D1Database, forAdmin = false) {
    const { results } = await db
      .prepare(
        `SELECT id, name, handle, avatar_color, avatar_media_id, joined_at
           FROM users
          WHERE status = 'approved' AND (role <> 'admin' OR ?)
          ORDER BY joined_at ASC`,
      )
      .bind(forAdmin ? 1 : 0)
      .all()
    return results ?? []
  },
}
