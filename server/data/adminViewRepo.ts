import type { D1Database } from '../fitness/repo'

/**
 * What an administrator may read about one member. Nothing it may write.
 *
 * This file deliberately reverses a decision the rest of the server made, so
 * it is worth being plain about what changed and what did not.
 *
 * The original rule was that no route could return another person's rows at
 * all: every ownership-scoped query took its owner from the session cookie, so
 * there was no parameter an admin could set to act as somebody else. That made
 * "an admin cannot read your meals" true by construction rather than by a
 * check somebody could forget.
 *
 * The product now asks for the opposite: one administrator who can see
 * everyone, so that a group of people who train together has somebody able to
 * answer "is this person actually logging anything". So the owner arrives as a
 * path parameter here, and the guarantee moves from "impossible" to "narrow,
 * one-way and visible in one file".
 *
 * Three properties hold that narrowness, and each is structural rather than
 * remembered:
 *
 * **Read-only, because there is nothing else here.** Every function below is a
 * SELECT. There is no update, no delete, and no insert — not disabled, absent.
 * The route that calls this registers `onRequestGet` alone, so a POST or a
 * PATCH to a member's data is a 405 before any of this is reached.
 *
 * **Owner-scoped, still.** Every statement carries `WHERE user_id = ?`. The
 * owner is now named by the caller rather than by the cookie, but a query that
 * returns "everyone's weights" does not exist here either — an admin reads one
 * person at a time, deliberately, and `scripts/check-isolation.ts` still reads
 * this file and still requires the clause.
 *
 * **Reachable only behind `requireAdmin`.** Which reads the role from the D1
 * user row on every request, as it always did.
 *
 * What is NOT here matters as much. No password material and no session token:
 * the profile select names its columns rather than taking `*`, so a credential
 * column added to `users` later cannot arrive here by growing into a wildcard.
 */

/** Enough rows to see a pattern, few enough to stay one response. */
const RECENT = 90

export interface MemberProfile {
  id: string
  name: string
  handle: string | null
  email: string | null
  role: string
  status: string
  avatar_color: string
  birth_date: string | null
  sex: string | null
  height_cm: number | null
  start_weight_kg: number | null
  target_weight_kg: number | null
  goal: string | null
  activity_level: string | null
  step_goal: number
  water_goal_l: number
  workouts_per_week_goal: number
  units: string
  joined_at: string
  created_at: string
}

const rows = async (db: D1Database, sql: string, ...binds: unknown[]) => {
  const { results } = await db.prepare(sql).bind(...binds).all()
  return results ?? []
}

export const adminViewRepo = {
  /**
   * The account, as columns rather than `*`.
   *
   * Named explicitly so that a column added to `users` later — a recovery
   * token, a credential, anything — does not silently start being returned
   * because a wildcard grew.
   */
  async profile(db: D1Database, userId: string): Promise<MemberProfile | null> {
    return db
      .prepare(
        `SELECT id, name, handle, email, role, status, avatar_color, birth_date, sex,
                height_cm, start_weight_kg, target_weight_kg, goal, activity_level,
                step_goal, water_goal_l, workouts_per_week_goal, units, joined_at, created_at
           FROM users
          WHERE id = ?`,
      )
      .bind(userId)
      .first<MemberProfile>()
  },

  /**
   * How much of each kind of thing this person has recorded.
   *
   * Usually the whole answer an administrator wants — "are they using it" is a
   * question about counts, not about what somebody ate on Tuesday. Reading the
   * detail below is a second, deliberate step.
   *
   * Scalar subqueries rather than a compound SELECT: D1 caps the number of
   * terms in a UNION, and a count per table is exactly the shape that hits it.
   */
  async summary(db: D1Database, userId: string) {
    return db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM workout_sessions WHERE user_id = ?) AS workouts,
           (SELECT COUNT(*) FROM weights          WHERE user_id = ?) AS weights,
           (SELECT COUNT(*) FROM measurements     WHERE user_id = ?) AS measurements,
           (SELECT COUNT(*) FROM food_entries     WHERE user_id = ?) AS meals,
           (SELECT COUNT(*) FROM water_entries    WHERE user_id = ?) AS water,
           (SELECT COUNT(*) FROM step_entries     WHERE user_id = ?) AS steps,
           (SELECT COUNT(*) FROM checkins         WHERE user_id = ?) AS checkins,
           (SELECT COUNT(*) FROM user_achievements WHERE user_id = ?) AS achievements,
           (SELECT COUNT(*) FROM plan_enrollments WHERE user_id = ?) AS enrollments,
           (SELECT MAX(date) FROM workout_sessions WHERE user_id = ?) AS last_workout,
           (SELECT MAX(date) FROM weights          WHERE user_id = ?) AS last_weigh_in`,
      )
      .bind(...Array<string>(11).fill(userId))
      .first()
  },

  /** The private logs, most recent first. One person, named by the caller. */
  async detail(db: D1Database, userId: string) {
    const [workouts, weights, measurements, meals, water, steps, checkins, achievements, enrollments] =
      await Promise.all([
        rows(db, 'SELECT * FROM workout_sessions WHERE user_id = ? ORDER BY date DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM weights WHERE user_id = ? ORDER BY date DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM measurements WHERE user_id = ? ORDER BY date DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM food_entries WHERE user_id = ? ORDER BY date DESC, created_at DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM water_entries WHERE user_id = ? ORDER BY date DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM step_entries WHERE user_id = ? ORDER BY date DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC LIMIT ?', userId, RECENT),
        rows(db, 'SELECT * FROM plan_enrollments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, RECENT),
      ])

    return { workouts, weights, measurements, meals, water, steps, checkins, achievements, enrollments }
  },

  /**
   * Everyone, with their counts, for the list an administrator lands on.
   *
   * Administrators are excluded from each other's view of the group for the
   * same reason members do not see them: an administrator is not a member of
   * this group, and listing one among the people who train would be listing
   * somebody who does not.
   */
  async members(db: D1Database, limit: number) {
    return rows(
      db,
      `SELECT u.id, u.name, u.handle, u.email, u.status, u.avatar_color, u.joined_at, u.created_at,
              (SELECT COUNT(*) FROM workout_sessions ws WHERE ws.user_id = u.id) AS workouts,
              (SELECT COUNT(*) FROM weights w          WHERE w.user_id = u.id)  AS weights,
              (SELECT MAX(ws.date) FROM workout_sessions ws WHERE ws.user_id = u.id) AS last_workout
         FROM users u
        WHERE u.role <> 'admin'
        ORDER BY u.created_at ASC
        LIMIT ?`,
      limit,
    )
  },
}
