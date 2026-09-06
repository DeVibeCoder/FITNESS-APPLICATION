import {
  requireApprovedUser,
  authFailureResponse,
  type AuthEnv,
  type AuthenticatedUser,
} from '../../../server/auth/guard'
import { InvalidInput } from '../../../server/data/validate'
import type { D1Database } from '../../../server/fitness/repo'

/**
 * The one way into any data route.
 *
 * Identical in shape and intent to the fitness guard, and deliberately so: the
 * caller is resolved from the session cookie before a handler runs, an account
 * that is pending, rejected or disabled is refused, and a handler receives the
 * user rather than being able to ask for one. No route below this file reads a
 * user id, a role or an account status from a request, so forging any of the
 * three achieves nothing.
 */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function withUser(
  context: { request: Request; env: { DB?: unknown } },
  handler: (user: AuthenticatedUser, db: D1Database) => Promise<Response>,
): Promise<Response> {
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
    // A bad payload is the caller's mistake and says which field.
    if (error instanceof InvalidInput) {
      return json({ error: 'invalid_input', field: error.field, message: error.message }, 400)
    }
    // Anything else is ours. The reason goes to the log and never to the
    // caller: a database message in a response describes the schema to
    // somebody who should not have it, and tells the user nothing they can
    // act on.
    console.log(
      JSON.stringify({
        at: 'data',
        failed: true,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
    return json({ error: 'server_error', message: 'That could not be saved. Try again.' }, 500)
  }
}
