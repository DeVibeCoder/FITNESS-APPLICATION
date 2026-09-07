/**
 * The few things an administrator does, and nothing else.
 *
 * This file is deliberately small, and its smallness is the design. An admin
 * on this application decides who gets in and who stops being in — that is the
 * whole job. There is no admin read of somebody's workouts, no admin edit of
 * somebody's profile, no admin route that takes a user id and acts as them.
 * Every ownership-scoped route in the rest of the server continues to resolve
 * its owner from the session, and being an administrator changes nothing about
 * that: an admin asking for `/api/data/nutrition/food` gets their own meals,
 * because the query has no other way to answer.
 *
 * So `role = 'admin'` grants exactly the routes in `functions/api/admin`, and
 * those routes are the only place `requireAdmin` is called.
 *
 * Two rules hold here as everywhere:
 *
 * The acting administrator is the authenticated session, never a field. There
 * is no `adminId` parameter to forge, because the caller does not get to say
 * who is deciding.
 *
 * And an admin cannot decide about themselves. Approving your own pending
 * account, or disabling your way out of a mistake, is the one shape of this
 * that turns an account into a privilege escalation, so it is refused by the
 * statement rather than by remembering not to.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

const nowIso = () => new Date().toISOString()

/** The decisions an administrator may record about an account. */
const DECISIONS = ['approved', 'rejected', 'disabled'] as const

export function validateDecision(input: unknown) {
  const raw = v.body(input)
  return {
    userId: v.id(raw.userId, 'userId'),
    status: v.oneOf(raw.status, 'status', DECISIONS),
  }
}

export const adminRepo = {
  /**
   * Accounts, for the approval screen.
   *
   * Returns what a decision needs and no more: who asked, when, and what has
   * been decided so far. No password material, no session token, no workout,
   * meal or message belonging to anybody — an approval queue is not a window
   * into people's training.
   */
  async accounts(db: D1Database, status: string | null, limit: number) {
    const clauses = status ? 'WHERE status = ?' : ''
    const binds = status ? [status, limit] : [limit]
    const { results } = await db
      .prepare(
        `SELECT id, name, handle, email, role, status, decided_at, decided_by, created_at
           FROM users ${clauses}
          ORDER BY created_at ASC
          LIMIT ?`,
      )
      .bind(...binds)
      .all()
    return results ?? []
  },

  async pendingCount(db: D1Database) {
    const row = await db
      .prepare("SELECT COUNT(*) AS waiting FROM users WHERE status = 'pending'")
      .first<{ waiting: number }>()
    return row?.waiting ?? 0
  },

  /**
   * Records a decision about somebody else's account.
   *
   * `id <> ?` on the acting admin is what stops this being a way to promote or
   * rescue yourself. The row is not touched when the target is the caller, and
   * the caller is told so rather than being handed a silent success.
   */
  async decide(
    db: D1Database,
    adminId: string,
    input: ReturnType<typeof validateDecision>,
  ): Promise<'done' | 'not_found' | 'self'> {
    if (input.userId === adminId) return 'self'

    const target = await db
      .prepare('SELECT id FROM users WHERE id = ?')
      .bind(input.userId)
      .first<{ id: string }>()
    if (!target) return 'not_found'

    await db
      .prepare(
        `UPDATE users
            SET status = ?, decided_at = ?, decided_by = ?, updated_at = ?
          WHERE id = ? AND id <> ?`,
      )
      .bind(input.status, nowIso(), adminId, nowIso(), input.userId, adminId)
      .run()

    /*
     * A rejected or disabled account keeps its rows and loses its way in. Its
     * sessions go, so a decision takes effect on the next request rather than
     * whenever a cookie happens to expire — the guard re-reads status from the
     * user row on every call, and this closes the window in between.
     */
    if (input.status !== 'approved') {
      await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(input.userId).run()
    }
    return 'done'
  },
}
