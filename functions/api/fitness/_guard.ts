import { requireApprovedUser, authFailureResponse, type AuthEnv, type AuthenticatedUser } from '../../../server/auth/guard'
import { InvalidWorkout } from '../../../server/fitness/validate'
import type { D1Database } from '../../../server/fitness/repo'

/**
 * The one way into any fitness route.
 *
 * Resolves the caller from the session cookie and refuses anything that is
 * not an approved account, before a handler can touch a row. Handlers receive
 * the user; they never receive, and cannot ask for, a user id from the
 * request.
 */
export interface FitnessEnv extends AuthEnv {
  DB: never
}

export async function withUser(
  context: { request: Request; env: { DB?: unknown } },
  handler: (user: AuthenticatedUser, db: D1Database) => Promise<Response>,
): Promise<Response> {
  const json = (body: unknown, status: number) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

  // No database bound means nobody can be authenticated, so nobody is.
  if (!context.env.DB) {
    return json({ error: 'unauthenticated', message: 'Sign in to continue.' }, 401)
  }

  let user: AuthenticatedUser
  try {
    user = await requireApprovedUser(context.request, context.env as unknown as AuthEnv)
  } catch (error) {
    const refusal = authFailureResponse(error)
    if (refusal) return refusal
    throw error
  }

  try {
    return await handler(user, context.env.DB as D1Database)
  } catch (error) {
    // A bad payload is the caller's mistake and says which field; anything
    // else is ours and does not leak its internals.
    if (error instanceof InvalidWorkout) {
      return json({ error: 'invalid_workout', field: error.field, message: error.message }, 400)
    }
    // The reason goes to the log, never to the caller: a database message
    // in a response tells an attacker about the schema, and tells the user
    // nothing they can act on.
    console.log(
      JSON.stringify({
        at: 'fitness',
        failed: true,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
    return json({ error: 'server_error', message: 'That could not be saved. Try again.' }, 500)
  }
}
