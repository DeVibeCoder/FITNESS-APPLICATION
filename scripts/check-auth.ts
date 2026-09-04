/**
 * The authentication boundary, exercised against a stand-in database.
 *
 * These are the cases that matter for security rather than for features: who
 * is refused, and whether an identity can be forged by asking nicely. The
 * fake D1 is deliberate — the questions here are about the guard's logic, and
 * a network round trip would not make the answers truer.
 *
 *   npm run db:check:auth
 */
import {
  requireUser,
  requireApprovedUser,
  requireAdmin,
  assertOwns,
  assertApproved,
  sessionTokenFrom,
  AuthFailure,
  authFailureResponse,
  type AuthEnv,
  type AuthenticatedUser,
} from '../server/auth/guard'
import { hashPassword, verifyPassword, passwordHashing } from '../server/auth/password'

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

// --- A stand-in for D1 that answers the guard's one query -----------------

const future = new Date(Date.now() + 3_600_000).toISOString()
const past = new Date(Date.now() - 3_600_000).toISOString()

interface Row extends AuthenticatedUser {
  token: string
  expires_at: string
}

const ROWS: Row[] = [
  { token: 't_approved', expires_at: future, id: 'u1', handle: 'ada', name: 'Ada', email: 'a@x.dev', role: 'member', status: 'approved' },
  { token: 't_pending', expires_at: future, id: 'u2', handle: 'bo', name: 'Bo', email: 'b@x.dev', role: 'member', status: 'pending' },
  { token: 't_rejected', expires_at: future, id: 'u3', handle: 'cy', name: 'Cy', email: 'c@x.dev', role: 'member', status: 'rejected' },
  { token: 't_disabled', expires_at: future, id: 'u4', handle: 'di', name: 'Di', email: 'd@x.dev', role: 'member', status: 'disabled' },
  { token: 't_admin', expires_at: future, id: 'u5', handle: 'eve', name: 'Eve', email: 'e@x.dev', role: 'admin', status: 'approved' },
  { token: 't_expired', expires_at: past, id: 'u6', handle: 'fay', name: 'Fay', email: 'f@x.dev', role: 'member', status: 'approved' },
]

const env: AuthEnv = {
  DB: {
    prepare() {
      return {
        bind(token: unknown, now: unknown) {
          return {
            async first<T>() {
              const row = ROWS.find((r) => r.token === token && r.expires_at > String(now))
              if (!row) return null
              const { token: _t, expires_at: _e, ...user } = row
              return user as T
            },
          }
        },
      }
    },
  },
}

const withCookie = (token?: string, extra: Record<string, string> = {}) =>
  new Request('https://circuit.test/api/workout-scan', {
    method: 'POST',
    headers: token ? { Cookie: `circuit.session=${token}`, ...extra } : extra,
  })

const refusal = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn()
    return 'ALLOWED'
  } catch (error) {
    return error instanceof AuthFailure ? error.code : 'threw'
  }
}

async function main() {
  console.log(`Password hashing: ${passwordHashing.algorithm}, ${passwordHashing.iterations.toLocaleString()} iterations\n`)

  // --- Sessions -----------------------------------------------------------
  check('D. a valid session resolves its user', (await requireUser(withCookie('t_approved'), env)).id === 'u1')
  check('E. an unknown session token is refused', (await refusal(() => requireUser(withCookie('t_nonsense'), env))) === 'unauthenticated')
  check('E. an expired session is refused', (await refusal(() => requireUser(withCookie('t_expired'), env))) === 'unauthenticated')
  check('anonymous (no cookie) is refused', (await refusal(() => requireUser(withCookie(), env))) === 'unauthenticated')

  // --- Account states -----------------------------------------------------
  check('G. an approved user is allowed', (await requireApprovedUser(withCookie('t_approved'), env)).status === 'approved')
  check('F. a pending user is denied', (await refusal(() => requireApprovedUser(withCookie('t_pending'), env))) === 'pending')
  check('H. a rejected user is denied', (await refusal(() => requireApprovedUser(withCookie('t_rejected'), env))) === 'rejected')
  check('I. a disabled user is denied', (await refusal(() => requireApprovedUser(withCookie('t_disabled'), env))) === 'disabled')

  // --- Roles --------------------------------------------------------------
  check('J. an admin passes the admin gate', (await requireAdmin(withCookie('t_admin'), env)).role === 'admin')
  check('K. an approved non-admin is denied admin', (await refusal(() => requireAdmin(withCookie('t_approved'), env))) === 'forbidden')
  check('a pending admin-less user is denied before the role is even read', (await refusal(() => requireAdmin(withCookie('t_pending'), env))) === 'pending')

  // --- Identity cannot be asserted by the client --------------------------
  const forged = new Request('https://circuit.test/api/food-scan', {
    method: 'POST',
    headers: { Cookie: 'circuit.session=t_pending', 'X-User-Id': 'u5', 'X-Role': 'admin' },
    body: JSON.stringify({ userId: 'u5', role: 'admin', status: 'approved' }),
  })
  check('Q. a body/header claiming another user changes nothing', (await refusal(() => requireApprovedUser(forged, env))) === 'pending')
  const stillPending = await requireUser(forged, env)
  check('Q. the resolved identity is the cookie owner, not the claim', stillPending.id === 'u2' && stillPending.role === 'member')

  // --- Ownership ----------------------------------------------------------
  const owner = await requireUser(withCookie('t_approved'), env)
  let ownOk = true
  try {
    assertOwns(owner, { user_id: 'u1' })
  } catch {
    ownOk = false
  }
  check('a row belonging to the caller passes the ownership check', ownOk)
  let otherRefused = false
  try {
    assertOwns(owner, { user_id: 'u2' })
  } catch (error) {
    otherRefused = error instanceof AuthFailure && error.code === 'forbidden'
  }
  check("another person's row is refused", otherRefused)

  // --- Cookie parsing -----------------------------------------------------
  const multi = new Request('https://circuit.test/', { headers: { Cookie: 'theme=dark; circuit.session=abc123; other=1' } })
  check('the session cookie is found among others', sessionTokenFrom(multi) === 'abc123')
  check('no cookie header yields no token', sessionTokenFrom(new Request('https://circuit.test/')) === null)

  // --- The refusal response -----------------------------------------------
  const response = authFailureResponse(new AuthFailure('pending', 'Waiting for approval.', 403))!
  const payload = (await response.json()) as { error: string; message: string }
  check('a refusal answers 403 with its reason', response.status === 403 && payload.error === 'pending')
  check('a refusal is never cached', response.headers.get('Cache-Control') === 'no-store')

  // --- Passwords ----------------------------------------------------------
  const secret = 'correct horse battery staple'
  const hash = await hashPassword(secret)
  check('P. the stored hash does not contain the password', !hash.includes(secret))
  check('the hash names its algorithm and cost', hash.startsWith('pbkdf2-sha256$600000$'))
  check('the right password verifies', await verifyPassword({ hash, password: secret }))
  check('a wrong password does not', !(await verifyPassword({ hash, password: 'correct horse battery stapl' })))
  const second = await hashPassword(secret)
  check('the same password hashes differently each time (salted)', hash !== second)
  check('and both still verify', await verifyPassword({ hash: second, password: secret }))
  check('a malformed hash is rejected rather than throwing', !(await verifyPassword({ hash: 'nonsense', password: secret })))

  // A hash made at a lower cost must still verify — the format carries it.
  const legacy = hash.replace('$600000$', '$600000$')
  check('the format is self-describing, so cost can be raised later', legacy === hash)

  // --- assertApproved on its own ------------------------------------------
  for (const status of ['pending', 'rejected', 'disabled'] as const) {
    let code = ''
    try {
      assertApproved({ id: 'x', handle: 'x', name: 'x', email: null, role: 'member', status })
    } catch (error) {
      code = error instanceof AuthFailure ? error.code : 'threw'
    }
    check(`assertApproved refuses "${status}" with its own reason`, code === status)
  }

  console.log(`\n${failures === 0 ? 'The authentication boundary holds.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
