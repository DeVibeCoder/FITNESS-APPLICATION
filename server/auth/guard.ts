/**
 * The security boundary, in one small file.
 *
 * Every protected handler starts here and gets an identity it did not have to
 * trust the client for. The rule the rest of the backend depends on:
 *
 *   identity comes from the session cookie, resolved against the database.
 *   Never from a request body, a header the client sets, or a query string.
 *
 * The old application had none of this — a user id in localStorage was the
 * whole of it, and the code said so. This replaces it.
 */

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled'
export type UserRole = 'admin' | 'member'

export interface AuthenticatedUser {
  id: string
  handle: string
  name: string
  email: string | null
  role: UserRole
  status: AccountStatus
}

/** Why a request was refused, and what the caller should send back. */
export class AuthFailure extends Error {
  readonly code: 'unauthenticated' | 'pending' | 'rejected' | 'disabled' | 'forbidden'
  readonly status: number

  constructor(code: AuthFailure['code'], message: string, status: number) {
    super(message)
    this.name = 'AuthFailure'
    this.code = code
    this.status = status
  }
}

/** What a handler needs from its environment to authenticate anybody. */
export interface AuthEnv {
  DB: D1Database
}

/**
 * Minimal D1 shape, declared locally so this file needs no Workers types at
 * build time. The real binding satisfies it.
 */
export interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>
    }
  }
}

/**
 * Reads the session token out of the cookie header.
 *
 * Two details that are easy to get wrong and silently authenticate nobody:
 *
 * The cookie is named `<prefix>.session_token`, not `<prefix>.session` — the
 * prefix in the Better Auth config is only the first half of the name.
 *
 * And its value is `<token>.<signature>`, while `auth_sessions.token` holds
 * the token alone. Looking the whole cookie value up in the database matches
 * no row, which fails exactly like an expired session and is far harder to
 * read. The signature is the library's to verify; the part before the first
 * dot is what identifies the row.
 */
export function sessionTokenFrom(
  request: Request,
  cookieName = 'circuit.session_token',
): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name !== cookieName) continue
    const value = decodeURIComponent(rest.join('='))
    if (!value) return null
    const [token] = value.split('.')
    return token || null
  }
  return null
}

/**
 * Resolves the caller, or throws.
 *
 * One query, joined, so a session and its user are read as a unit and an
 * expired row cannot be used while the user lookup succeeds.
 */
export async function requireUser(request: Request, env: AuthEnv): Promise<AuthenticatedUser> {
  const token = sessionTokenFrom(request)
  if (!token) throw new AuthFailure('unauthenticated', 'Sign in to continue.', 401)

  const row = await env.DB.prepare(
    `SELECT u.id, u.handle, u.name, u.email, u.role, u.status
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`,
  )
    .bind(token, new Date().toISOString())
    .first<AuthenticatedUser>()

  if (!row) throw new AuthFailure('unauthenticated', 'Your session has expired. Sign in again.', 401)
  return row
}

/**
 * The gate for anything that touches real application data.
 *
 * Each refused state gets its own code, because "pending" and "disabled" are
 * different sentences to read on a screen: one is waiting, the other is over.
 */
export function assertApproved(user: AuthenticatedUser): void {
  if (user.status === 'approved') return
  if (user.status === 'pending') {
    throw new AuthFailure('pending', 'Your account is waiting for approval.', 403)
  }
  if (user.status === 'rejected') {
    throw new AuthFailure('rejected', 'This account was not approved.', 403)
  }
  throw new AuthFailure('disabled', 'This account has been disabled.', 403)
}

export async function requireApprovedUser(
  request: Request,
  env: AuthEnv,
): Promise<AuthenticatedUser> {
  const user = await requireUser(request, env)
  assertApproved(user)
  return user
}

/** Admin is a column on the user row, read server-side. Never a client claim. */
export async function requireAdmin(request: Request, env: AuthEnv): Promise<AuthenticatedUser> {
  const user = await requireApprovedUser(request, env)
  if (user.role !== 'admin') {
    throw new AuthFailure('forbidden', 'That is an administrator action.', 403)
  }
  return user
}

/**
 * Ownership, for rows that belong to one person.
 *
 * Takes the id off the authenticated user rather than accepting one, so a
 * handler cannot accidentally pass the client's opinion in.
 */
export function assertOwns(user: AuthenticatedUser, row: { user_id?: string } | undefined): void {
  if (!row) return
  if (row.user_id !== user.id) {
    throw new AuthFailure('forbidden', 'That is not yours to change.', 403)
  }
}

/** Turns a failure into the response a handler should return. */
export function authFailureResponse(error: unknown): Response | null {
  if (!(error instanceof AuthFailure)) return null
  return Response.json(
    { error: error.code, message: error.message },
    { status: error.status, headers: { 'Cache-Control': 'no-store' } },
  )
}
