/**
 * The administrator's routes, and the only place `requireAdmin` is called.
 *
 * Everything under `/api/admin` needs `role = 'admin'` on the user row, read
 * from the database on every request. The role is never taken from a body, a
 * header or a token claim, so there is nothing here for a client to forge; a
 * member who calls these gets 403 whatever they send.
 *
 * Note what is NOT here. There is no route that reads or writes somebody
 * else's workouts, meals, posts or messages. An administrator moderates
 * accounts; they do not get a skeleton key to the group's training. The rest
 * of the API resolves its owner from the session exactly as before, which
 * means an admin calling a member route acts as themselves — not because a
 * check forbids otherwise, but because there is no parameter that could ask.
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
