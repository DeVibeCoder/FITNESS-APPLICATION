/**
 * The real session, as far as the browser is concerned.
 *
 * Everything here asks the server. Nothing is cached in `localStorage`,
 * because a value the page can write is a value the page can lie about — and
 * the old authentication did exactly that: a user id in local storage was the
 * whole of it.
 *
 * The cookie the server sets is `httpOnly`, so this module cannot read it and
 * neither can anything else running on the page. The only way to learn who
 * you are is to ask, which is the point.
 *
 * Note what this module does NOT do: it does not decide anything. Approval
 * state and role come back from the server for the interface to render, and
 * the server checks them again on every protected request. A screen that
 * hides a button is a courtesy, not a boundary.
 */

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled'
export type UserRole = 'admin' | 'member'

export interface ServerUser {
  id: string
  name: string
  email: string | null
  handle?: string | null
  image?: string | null
  role: UserRole
  status: AccountStatus
}

export class ServerAuthError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ServerAuthError'
    this.code = code
    this.status = status
  }
}

const BASE = '/api/auth'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    // Without this the session cookie is not sent, and every call looks
    // anonymous no matter who is signed in.
    credentials: 'include',
  })

  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    // A bare `null` is a valid answer meaning "no session", and anything
    // unparseable means this was never the API to begin with.
    payload = text ? ((JSON.parse(text) as Record<string, unknown> | null) ?? {}) : {}
  } catch {
    throw new ServerAuthError('not_json', 'The authentication service did not answer.', response.status)
  }

  if (!response.ok) {
    throw new ServerAuthError(
      String(payload.code ?? payload.error ?? 'auth_failed'),
      String(payload.message ?? 'That did not work. Try again.'),
      response.status,
    )
  }
  return payload as T
}

export const serverAuthService = {
  /**
   * Who the caller is, or nobody.
   *
   * Returns null rather than throwing for a missing session: not being signed
   * in is an ordinary state on first load, not an error to handle.
   */
  async currentUser(): Promise<ServerUser | null> {
    try {
      const session = await call<{ user?: ServerUser } | null>('/get-session')
      return session?.user ?? null
    } catch (error) {
      if (error instanceof ServerAuthError && (error.status === 401 || error.status === 404)) return null
      throw error
    }
  },

  /**
   * Creates an account. It arrives `pending` — the server decides that, and
   * an admin decides what happens next.
   */
  async signUp(input: { email: string; password: string; name: string }): Promise<ServerUser | null> {
    await call('/sign-up/email', { method: 'POST', body: JSON.stringify(input) })
    return this.currentUser()
  },

  async signIn(input: { email: string; password: string }): Promise<ServerUser | null> {
    await call('/sign-in/email', { method: 'POST', body: JSON.stringify(input) })
    return this.currentUser()
  },

  async signOut(): Promise<void> {
    await call('/sign-out', { method: 'POST', body: '{}' })
  },

  /** Sends the reset email, when an email sender exists to send it. */
  async requestPasswordReset(email: string): Promise<void> {
    await call('/forget-password', {
      method: 'POST',
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    })
  },

  async resetPassword(input: { token: string; newPassword: string }): Promise<void> {
    await call('/reset-password', { method: 'POST', body: JSON.stringify(input) })
  },

  /** Hands the browser to Google. The callback lands back on this origin. */
  startGoogleSignIn(callbackPath = '/'): void {
    const url = new URL(`${BASE}/sign-in/social`, window.location.origin)
    url.searchParams.set('provider', 'google')
    url.searchParams.set('callbackURL', callbackPath)
    window.location.assign(url.toString())
  },

  /**
   * Whether this deployment can authenticate at all. The route answers 503
   * when it has no database or no secret, which is a different thing from
   * wrong credentials and should read differently on screen.
   */
  async available(): Promise<boolean> {
    try {
      const response = await fetch(`${BASE}/get-session`, { credentials: 'include' })
      // 503 is the route saying it exists but cannot authenticate anybody.
      if (response.status === 503) return false
      /*
       * And the important case: where no Functions are deployed at all, this
       * path falls through to the SPA and answers 200 with index.html. A
       * status check alone reads that as a working backend, and the app then
       * tries to parse a web page as a session. The content type is what
       * actually distinguishes an API from the application it serves.
       */
      return (response.headers.get('Content-Type') ?? '').includes('json')
    } catch {
      return false
    }
  },
}
