/**
 * The Better Auth instance, built per request from the Worker's environment.
 *
 * Built per request rather than once at module scope because the D1 binding
 * and the secrets arrive on `env`, which only exists inside a request. That
 * is the shape Workers imposes, not a preference.
 *
 * Better Auth accepts a `D1Database` directly — its Kysely adapter ships a D1
 * dialect — so there is no extra driver package and no hand-written SQL for
 * the auth tables.
 */
import { betterAuth } from 'better-auth'
import { hashPassword, verifyPassword } from './password'

export interface AuthEnvironment {
  DB: unknown
  AUTH_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  ENVIRONMENT?: string
  BASE_URL?: string
}

/** Thrown when the environment cannot support authentication at all. */
export class AuthNotConfigured extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthNotConfigured'
  }
}

/**
 * Sessions last a week and slide forward a day at a time, so somebody who
 * opens the app most days is never signed out, and a device left in a drawer
 * eventually is.
 */
const SESSION_DAYS = 7
const SESSION_REFRESH_DAYS = 1

export function createAuth(env: AuthEnvironment, request?: Request) {
  if (!env.DB) {
    throw new AuthNotConfigured('No database is bound, so nobody can be authenticated.')
  }
  if (!env.AUTH_SECRET) {
    // Refuses rather than inventing one: a generated secret would sign
    // sessions that stop verifying the moment the isolate is replaced.
    throw new AuthNotConfigured('AUTH_SECRET is not set.')
  }

  const production = env.ENVIRONMENT === 'production'
  const baseURL = env.BASE_URL ?? (request ? new URL(request.url).origin : undefined)

  return betterAuth({
    database: env.DB as never,
    secret: env.AUTH_SECRET,
    baseURL,
    basePath: '/api/auth',

    // Our table names, from migrations 0001 and 0005.
    user: {
      modelName: 'users',
      additionalFields: {
        // Approval state and role live on the user row and are read
        // server-side. They are not in the session cookie, so a stale cookie
        // cannot carry a stale approval.
        status: { type: 'string', defaultValue: 'pending', input: false },
        role: { type: 'string', defaultValue: 'member', input: false },
        handle: { type: 'string', required: false, input: false },
      },
    },
    session: { modelName: 'auth_sessions', expiresIn: 60 * 60 * 24 * SESSION_DAYS, updateAge: 60 * 60 * 24 * SESSION_REFRESH_DAYS },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verification_tokens' },

    emailAndPassword: {
      enabled: true,
      // Phase 3: Better Auth's own scrypt falls back to pure JavaScript on
      // Workers at r=16 — 472ms and 32MB per login. This replaces it with
      // PBKDF2 through Web Crypto. See password.ts for the measurements.
      password: { hash: hashPassword, verify: verifyPassword },
      minPasswordLength: 10,
      // Recovery is wired but cannot deliver until an email sender exists.
      // Left explicit so the gap is visible rather than silently missing.
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        console.log(JSON.stringify({ at: 'password_reset', email: user.email, hasUrl: Boolean(url) }))
        throw new Error('Password reset email delivery is not configured yet.')
      },
    },

    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},

    advanced: {
      cookiePrefix: 'circuit',
      // Secure everywhere it can be. Locally over http the cookie would not
      // be sent at all if this were forced on.
      useSecureCookies: production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: production,
      },
    },
  })
}

/** Whether Google sign-in is actually available in this environment. */
export function googleConfigured(env: AuthEnvironment): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}
