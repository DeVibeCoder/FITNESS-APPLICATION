import { createAuth, AuthNotConfigured, type AuthEnvironment } from '../../../server/auth/auth'

/**
 * Everything under /api/auth — signup, login, logout, session, the Google
 * redirect and its callback.
 *
 * One catch-all rather than a file per route, because Better Auth owns the
 * routing underneath and splitting it would mean re-declaring its URL shape
 * in two places.
 *
 * Nothing here inspects credentials. The library reads the request, writes
 * the session row and sets the cookie; this function only hands it the
 * environment and returns what comes back.
 */
export const onRequest = async (context: {
  request: Request
  env: AuthEnvironment
}): Promise<Response> => {
  try {
    const auth = createAuth(context.env, context.request)
    return await auth.handler(context.request)
  } catch (error) {
    if (error instanceof AuthNotConfigured) {
      // A deployment that cannot authenticate says so plainly rather than
      // failing in a way that looks like wrong credentials.
      return Response.json(
        { error: 'auth_not_configured', message: 'Sign-in is not available on this deployment.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    throw error
  }
}
