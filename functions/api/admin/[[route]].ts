/**
 * The administrator's routes, and the only place `requireAdmin` is called.
 *
 * Everything under `/api/admin` needs `role = 'admin'` on the user row, read
 * from the database on every request. The role is never taken from a body, a
 * header or a token claim, so there is nothing here for a client to forge; a
 * member who calls these gets 403 whatever they send.
 *
 * What an administrator may do, precisely:
 *
 *   POST /accounts            approve, reject or disable somebody else
 *   GET  /accounts            the queue
 *   GET  /members             everyone, with counts
 *   GET  /members/<id>        one member's own logs, read-only
 *
 * The read routes are new, and they reverse what this file used to say. There
 * was no way to read another person's rows at all: every ownership-scoped
 * query took its owner from the session, so no parameter existed that could
 * ask on somebody else's behalf. That is no longer true, by request — a group
 * that trains together wanted somebody able to see whether people are actually
 * logging.
 *
 * So the reach is real, and it is bounded in ways that are structural rather
 * than remembered:
 *
 * **It is one-way.** `GET` only. `onRequestPost` below dispatches to the
 * decision handler and nothing else, so there is no admin path that writes a
 * member's workout, meal, weight or profile — a POST or PATCH under
 * `/members` is refused before any repository is reached. An administrator can
 * see that somebody logged nothing this week; they cannot log it for them, and
 * they cannot change a setting that belongs to that person.
 *
 * **It names one person at a time.** `adminViewRepo` has no query that returns
 * everyone's private rows at once; the owner is still in every WHERE clause,
 * and `scripts/check-isolation.ts` still holds this file to that.
 *
 * **The rest of the API is unchanged.** Every member route still resolves its
 * owner from the session, so an admin calling `/api/data/nutrition/food` gets
 * their own meals — not because a check forbids otherwise, but because there
 * is still no parameter that could ask.
 */
import {
  requireAdmin,
  authFailureResponse,
  type AuthEnv,
  type AuthenticatedUser,
} from '../../../server/auth/guard'
import { InvalidInput } from '../../../server/data/validate'
import * as v from '../../../server/data/validate'
import { adminRepo, validateDecision } from '../../../server/data/adminRepo'
import { adminViewRepo } from '../../../server/data/adminViewRepo'
import type { D1Database } from '../../../server/fitness/repo'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function withAdmin(
  context: { request: Request; env: { DB?: unknown } },
  handler: (admin: AuthenticatedUser, db: D1Database) => Promise<Response>,
): Promise<Response> {
  if (!context.env.DB) {
    return json({ error: 'unauthenticated', message: 'Sign in to continue.' }, 401)
  }

  let admin: AuthenticatedUser
  try {
    admin = await requireAdmin(context.request, context.env as unknown as AuthEnv)
  } catch (error) {
    const refusal = authFailureResponse(error)
    if (refusal) return refusal
    throw error
  }

  try {
    return await handler(admin, context.env.DB as D1Database)
  } catch (error) {
    if (error instanceof InvalidInput) {
      return json({ error: 'invalid_input', field: error.field, message: error.message }, 400)
    }
    console.log(
      JSON.stringify({
        at: 'admin',
        failed: true,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
    return json({ error: 'server_error', message: 'That could not be done. Try again.' }, 500)
  }
}

const handle = (context: {
  request: Request
  env: { DB?: unknown }
  params: { route?: string | string[] }
}) =>
  withAdmin(context, async (admin, db) => {
    const segments = Array.isArray(context.params.route)
      ? context.params.route
      : (context.params.route ?? '').split('/').filter(Boolean)
    const resource = segments[0] ?? ''
    const url = new URL(context.request.url)

    if (resource === 'accounts' && context.request.method === 'GET') {
      const status = url.searchParams.get('status')
      return json({
        accounts: await adminRepo.accounts(db, status, v.limit(url.searchParams.get('limit'), 200, 1000)),
        pending: await adminRepo.pendingCount(db),
      })
    }

    /*
     * Everyone, with enough per-person counts to see at a glance who is using
     * the app. Administrators are left out: an admin is not a member of the
     * group, and listing one among the people who train would say otherwise.
     */
    if (resource === 'members' && segments.length === 1 && context.request.method === 'GET') {
      return json({ members: await adminViewRepo.members(db, v.limit(url.searchParams.get('limit'), 200, 1000)) })
    }

    /*
     * One member, in full. The id is a path segment rather than a query
     * parameter for no reason other than legibility — either way it is a
     * caller-supplied owner, which is exactly the thing the rest of this
     * server refuses, and exactly what `requireAdmin` above is here to gate.
     */
    if (resource === 'members' && segments.length === 2 && context.request.method === 'GET') {
      const target = v.id(segments[1], 'userId')
      const profile = await adminViewRepo.profile(db, target)
      if (!profile) {
        return json({ error: 'not_found', message: 'There is no such account.' }, 404)
      }
      /*
       * An administrator's own account is not a member to inspect. Refused
       * rather than quietly returned, so the list and the detail agree about
       * who exists.
       */
      if (profile.role === 'admin') {
        return json({ error: 'not_found', message: 'There is no such account.' }, 404)
      }
      return json({
        profile,
        summary: await adminViewRepo.summary(db, target),
        ...(await adminViewRepo.detail(db, target)),
      })
    }

    if (resource === 'accounts' && context.request.method === 'POST') {
      const decision = validateDecision(await context.request.json())
      const outcome = await adminRepo.decide(db, admin.id, decision)
      if (outcome === 'not_found') {
        return json({ error: 'not_found', message: 'There is no such account.' }, 404)
      }
      if (outcome === 'self') {
        return json(
          { error: 'forbidden', message: 'An administrator cannot decide about their own account.' },
          403,
        )
      }
      return json({ ok: true })
    }

    return json({ error: 'not_found', message: 'That does not exist.' }, 404)
  })

export const onRequestGet = handle
export const onRequestPost = handle
