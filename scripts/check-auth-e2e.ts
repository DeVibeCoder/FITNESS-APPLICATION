/**
 * Authentication, against a real running Worker and a real D1 database.
 *
 * Everything else in this repo tests the guard's logic in isolation. This
 * drives the actual HTTP surface: signup writes a row, login sets a cookie,
 * the cookie survives being sent again, and logout stops it working.
 *
 * Start the server first:
 *   npx wrangler pages dev dist --port 8788 --d1 DB=circuit-dev \
 *     --compatibility-date 2026-08-22 --compatibility-flags nodejs_compat
 *
 * Then: npm run db:check:e2e
 *
 * No Gemini calls. The protected endpoints are proven reachable by sending a
 * malformed body: an approved user who gets `invalid_image` back has passed
 * authentication and stopped at validation, which is the thing being tested
 * and costs nothing.
 */
import { execSync } from 'node:child_process'

const BASE = process.env.E2E_BASE ?? 'http://localhost:8788'

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

/** Against the local D1 the Worker is using, so we can see what it wrote. */
function sql<T = Record<string, unknown>>(statement: string): T[] {
  const out = execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --json --command "${statement.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return (JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[]).flatMap((b) => b.results ?? [])
}

interface Reply {
  status: number
  body: Record<string, unknown>
  cookies: string[]
}

async function call(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Reply> {
  // A browser always sends Origin on a same-origin POST, and Better Auth
  // checks it. Omitting it here would test something no real client does.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: BASE,
    ...(init.headers as Record<string, string>),
  }
  if (init.cookie) headers.Cookie = init.cookie
  // wrangler's dev server drops idle keep-alive sockets, and undici reuses
  // them, so an otherwise fine request occasionally dies as "other side
  // closed". One retry on a transport error only — nothing about the
  // assertions changes.
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' })
  } catch {
    await new Promise((r) => setTimeout(r, 250))
    response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' })
  }
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    // get-session answers a bare `null` for no session, and null is not
    // an object to read `.user` off.
    body = text ? ((JSON.parse(text) as Record<string, unknown> | null) ?? {}) : {}
  } catch {
    body = { raw: text.slice(0, 120) }
  }
  return { status: response.status, body, cookies: response.headers.getSetCookie?.() ?? [] }
}

/** Pulls the session cookie out of Set-Cookie so it can be replayed. */
const sessionCookie = (cookies: string[]): string =>
  cookies
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('session'))
    .join('; ')

const stamp = Date.now()
const EMAIL = `e2e_${stamp}@circuit.test`
const PASSWORD = 'a-long-enough-password-1'

async function main() {
  console.log(`Target: ${BASE}\n`)

  // --- 1. Signup ----------------------------------------------------------
  const signUp = await call('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'E2E Tester' }),
  })
  check('1. signup succeeds', signUp.status >= 200 && signUp.status < 300, signUp.status)

  // --- 2/3. The row, and the state it starts in ---------------------------
  const rows = sql<{ id: string; email: string; status: string; role: string }>(
    `SELECT id, email, status, role FROM users WHERE email = '${EMAIL}';`,
  )
  check('2. the user exists in D1', rows.length === 1, rows.length)
  const user = rows[0]
  check('3. the account starts pending', user?.status === 'pending', user?.status)
  check('3. and as a member, not an admin', user?.role === 'member', user?.role)

  const accounts = sql<{ provider_id: string; password: string | null }>(
    `SELECT provider_id, password FROM auth_accounts WHERE user_id = '${user?.id}';`,
  )
  check('the credential is stored as a PBKDF2 verifier', Boolean(accounts[0]?.password?.startsWith('pbkdf2-sha256$600000$')))
  check('P. the stored verifier is not the password', !accounts[0]?.password?.includes(PASSWORD))

  // --- 13a. A pending user cannot reach the expensive endpoints -----------
  const pendingLogin = await call('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const pendingCookie = sessionCookie(pendingLogin.cookies)
  check('a pending user can still sign in (they must see their own status)', pendingLogin.status < 300 && Boolean(pendingCookie))

  for (const endpoint of ['/api/workout-scan', '/api/food-scan']) {
    const refused = await call(endpoint, {
      method: 'POST',
      cookie: pendingCookie,
      body: JSON.stringify({ imageBase64: 'aGk=', mimeType: 'image/png' }),
    })
    check(`13. pending user refused by ${endpoint}`, refused.status === 403 && refused.body.error === 'pending', refused.body.error)
  }

  // --- 4. Approve, the way an admin endpoint will ------------------------
  execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --command "UPDATE users SET status='approved' WHERE email='${EMAIL}';"`,
    { stdio: 'ignore' },
  )
  check('4. the account is approved server-side', sql<{ status: string }>(`SELECT status FROM users WHERE email='${EMAIL}';`)[0]?.status === 'approved')

  // --- 5/6. Login ---------------------------------------------------------
  const login = await call('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  check('5. login with the approved user succeeds', login.status < 300, login.status)
  const cookie = sessionCookie(login.cookies)
  check('6. a session cookie is issued', Boolean(cookie))
  const rawCookie = login.cookies.find((c) => c.includes('session')) ?? ''
  check('6. the cookie is HttpOnly', /HttpOnly/i.test(rawCookie))
  check('6. the cookie is SameSite=Lax', /SameSite=Lax/i.test(rawCookie))
  check('P. no password comes back in the login response', !JSON.stringify(login.body).includes(PASSWORD))

  const sessions = sql<{ token: string }>(`SELECT token FROM auth_sessions WHERE user_id='${user?.id}';`)
  check('the session was written to D1', sessions.length >= 1, sessions.length)

  // --- 7/8. Reload ---------------------------------------------------------
  const reloaded = await call('/api/auth/get-session', { cookie })
  const sessionUser = (reloaded.body as { user?: { id: string; email: string } }).user
  check('7/8. the session still resolves after a fresh request', sessionUser?.id === user?.id, sessionUser?.id)
  check('8. and resolves the same email', sessionUser?.email === EMAIL)

  // --- 9. A protected endpoint, with the real session ---------------------
  for (const endpoint of ['/api/workout-scan', '/api/food-scan']) {
    const allowed = await call(endpoint, { method: 'POST', cookie, body: '{ not json' })
    check(
      `9. approved user reaches validation on ${endpoint} (${allowed.body.error})`,
      allowed.status === 400 && allowed.body.error === 'invalid_image',
      allowed.body.error,
    )
  }

  // --- E. Identity cannot be asserted by the client -----------------------
  const forged = await call('/api/workout-scan', {
    method: 'POST',
    cookie: '',
    headers: { 'X-User-Id': String(user?.id), 'X-Role': 'admin' },
    body: JSON.stringify({ userId: user?.id, role: 'admin', status: 'approved', imageBase64: 'aGk=', mimeType: 'image/png' }),
  })
  check('E. a body/header claiming a user is still anonymous', forged.status === 401 && forged.body.error === 'unauthenticated', forged.body.error)

  const tampered = await call('/api/auth/get-session', { cookie: cookie.replace(/.$/, 'X') })
  check('E. a tampered session cookie resolves nobody', !(tampered.body as { user?: unknown }).user)

  // --- 12. Wrong password --------------------------------------------------
  const wrong = await call('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'not-the-right-password' }),
  })
  check('12. an invalid password is rejected', wrong.status >= 400, wrong.status)
  check('12. and no session cookie is issued', !sessionCookie(wrong.cookies))

  // --- 13b. Rejected and disabled ------------------------------------------
  for (const status of ['rejected', 'disabled'] as const) {
    execSync(
      `npx wrangler d1 execute circuit-dev --env preview --local --command "UPDATE users SET status='${status}' WHERE email='${EMAIL}';"`,
      { stdio: 'ignore' },
    )
    const refused = await call('/api/workout-scan', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ imageBase64: 'aGk=', mimeType: 'image/png' }),
    })
    check(`13. a ${status} user is refused (${refused.body.error})`, refused.status === 403 && refused.body.error === status, refused.body.error)
  }
  execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --command "UPDATE users SET status='approved' WHERE email='${EMAIL}';"`,
    { stdio: 'ignore' },
  )

  // --- 10/11. Logout --------------------------------------------------------
  const out = await call('/api/auth/sign-out', { method: 'POST', cookie, body: '{}' })
  check('10. logout succeeds', out.status < 300, out.status)
  const after = await call('/api/auth/get-session', { cookie })
  check('11. the session no longer resolves a user', !(after.body as { user?: unknown }).user)
  const dead = await call('/api/workout-scan', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ imageBase64: 'aGk=', mimeType: 'image/png' }),
  })
  check('11. and the protected endpoint refuses it', dead.status === 401, dead.status)

  // --- F. Password reset, honestly reported --------------------------------
  const reset = await call('/api/auth/forget-password', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, redirectTo: '/reset-password' }),
  })
  check('F. password reset fails loudly rather than pretending to send', reset.status >= 400, reset.status)

  // --- Cleanup: this account was only ever a test ---------------------------
  execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --command "DELETE FROM users WHERE email='${EMAIL}';"`,
    { stdio: 'ignore' },
  )
  const left = sql<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE email='${EMAIL}';`)[0]?.n
  check('the test account was removed again', left === 0, left)

  console.log(`\n${failures === 0 ? 'Authentication works end to end.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
