/**
 * What a pending account can do, which is nothing — and what changes the
 * moment somebody decides otherwise.
 *
 * `check-admin-api` proves the administrator boundary: who may approve, and
 * that being an admin is not a key to anybody's training. This proves the
 * other half of the same rule, from the applicant's side.
 *
 * Every assertion here is about a *session that already exists*. That is the
 * interesting case and the one a client-side gate cannot help with: an account
 * signs up, gets a perfectly valid cookie, and then asks for things anyway —
 * by typing a URL, by calling the API directly, by leaving a tab open across a
 * decision. The screens are not involved in any of this and neither is
 * anything a browser stores.
 *
 * The three states are checked separately because they are three different
 * mechanisms. `pending` is refused by the guard reading the user row.
 * `rejected` and `disabled` are refused by the guard too, but their sessions
 * are also deleted at the moment of the decision — so the cookie that worked a
 * second ago now resolves to nobody at all. One is a closed door; the other is
 * a closed door and a changed lock.
 *
 * Runs against the development database and removes its accounts afterwards.
 *
 *   npm run db:check:approval
 */
import { execSync } from 'node:child_process'

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8788'
const WRANGLER = 'node node_modules/wrangler/bin/wrangler.js'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
const head = (title: string) => console.log(`\n--- ${title} ---\n`)

const sql = (command: string) =>
  execSync(
    `${WRANGLER} d1 execute circuit-dev --env preview --local --json --command "${command.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 8e6, stdio: ['ignore', 'pipe', 'ignore'] },
  )
const query = <T>(command: string): T[] => {
  const out = sql(command)
  return (JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[]).flatMap((b) => b.results ?? [])
}

interface Account {
  email: string
  id: string
  cookie: string
}

/** One retry on a dropped keep-alive socket, as the other API checks do. */
async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    return fetch(url, init)
  }
}

const PASSWORD = 'a-long-enough-password-1'

/**
 * Signs an account up through the real endpoint and keeps its cookie.
 *
 * Nothing here sets `status` or `role`. That is the point: the only way to
 * make an approved account in this file is to have an administrator approve
 * it, or to write the column from outside the API with `wrangler`.
 */
async function signUp(label: string): Promise<Account> {
  const email = `flow_${label}_${Date.now()}@circuit.test`
  const created = await send(`${API}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API },
    body: JSON.stringify({ email, password: PASSWORD, name: `Flow ${label}` }),
  })
  if (!created.ok) throw new Error(`sign-up failed for ${label}: ${created.status}`)

  const signedIn = await send(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const cookie = (signedIn.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(';')[0].trim())
    .join('; ')
  const id = query<{ id: string }>(`SELECT id FROM users WHERE email='${email}';`)[0]?.id
  return { email, id, cookie }
}

const call = async (
  who: Account | null,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await send(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(who ? { Cookie: who.cookie } : {}),
      ...(init.headers ?? {}),
    },
  })
  const raw = await response.text()
  let body: Record<string, unknown> = {}
  try {
    // A bare `null` is get-session's honest answer for "no session", and it
    // parses to null rather than an object — which is a crash, not a failure,
    // if it is treated as one.
    body = raw ? ((JSON.parse(raw) as Record<string, unknown> | null) ?? {}) : {}
  } catch {
    body = { raw: raw.slice(0, 120) }
  }
  return { status: response.status, body }
}

const today = new Date().toISOString().slice(0, 10)
const rid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

/**
 * One write into every domain the application has, so "a pending account
 * cannot do anything" is checked against everything rather than a sample.
 */
const writes = (): { label: string; path: string; init: RequestInit }[] => [
  {
    label: 'log a workout',
    path: '/api/fitness/workouts',
    init: {
      method: 'POST',
      body: JSON.stringify({
        date: today,
        kind: 'strength',
        name: 'Pending probe',
        durationSec: 600,
        exercises: [{ name: 'Plank', kind: 'timed', sets: 3, durationSec: 45 }],
      }),
    },
  },
  {
    label: 'post to the group',
    path: '/api/data/social/posts',
    init: {
      method: 'POST',
      body: JSON.stringify({ id: rid('p'), type: 'text', text: 'Pending probe', visibility: 'group' }),
    },
  },
  {
    label: 'send a message',
    path: '/api/data/chat/messages',
    init: { method: 'POST', body: JSON.stringify({ id: rid('m'), text: 'Pending probe' }) },
  },
  {
    label: 'log a meal',
    path: '/api/data/nutrition/food',
    init: {
      method: 'POST',
      body: JSON.stringify({
        id: rid('f'), date: today, meal: 'lunch', name: 'Pending probe',
        portion: '1', kcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'manual',
      }),
    },
  },
  {
    label: 'record a weigh-in',
    path: '/api/data/nutrition/weights',
    init: { method: 'POST', body: JSON.stringify({ id: rid('w'), date: today, weightKg: 80 }) },
  },
]

/** Everything a member may read, which a pending account may not. */
const reads = (): { label: string; path: string }[] => [
  { label: 'their own profile', path: '/api/data/profile' },
  { label: 'the group roster', path: '/api/data/roster' },
  { label: 'the feed', path: '/api/data/social/posts' },
  { label: 'the conversation', path: '/api/data/chat/messages' },
  { label: 'their workouts', path: '/api/fitness/workouts' },
  { label: 'the exercise catalogue', path: '/api/fitness/exercises' },
]

async function main() {
  /*
   * Anything a previous run left behind. A run that fails partway through
   * never reaches its own cleanup, and the next run would then report those
   * leftovers as its own failure to tidy up — a red check about the check.
   */
  sql("DELETE FROM users WHERE email LIKE 'flow_%@circuit.test';")

  const admin = await signUp('admin')
  sql(`UPDATE users SET status='approved', role='admin' WHERE id='${admin.id}';`)

  head('Signing up gets you an account and nothing else')

  const waiting = await signUp('waiting')
  const row = query<{ role: string; status: string }>(
    `SELECT role, status FROM users WHERE id='${waiting.id}';`,
  )[0]
  check('a new account is a member', row?.role === 'member', row?.role)
  check('and it is pending', row?.status === 'pending', row?.status)
  check('it has a real session', waiting.cookie.length > 0)

  const session = await call(waiting, '/api/auth/get-session')
  check('which can read its own status', session.status === 200, session.status)
  check(
    'and that status is what the server says, not what the client hoped',
    (session.body.user as { status?: string } | undefined)?.status === 'pending',
    (session.body.user as { status?: string } | undefined)?.status,
  )

  head('A pending account cannot write anything, anywhere')

  for (const { label, path, init } of writes()) {
    const attempt = await call(waiting, path, init)
    check(`it cannot ${label}`, attempt.status === 403, { status: attempt.status, error: attempt.body.error })
    check(`and is told it is waiting, not that it is wrong`, attempt.body.error === 'pending', attempt.body.error)
  }

  head('And cannot read anything either')

  for (const { label, path } of reads()) {
    const attempt = await call(waiting, path)
    check(`it cannot read ${label}`, attempt.status === 403, { status: attempt.status, error: attempt.body.error })
  }

  head('Nothing it can put in a request changes that')

  const forged = [
    { label: 'a status header', init: { headers: { 'x-status': 'approved', 'x-user-status': 'approved' } } },
    { label: 'a role header', init: { headers: { 'x-role': 'admin' } } },
    {
      label: 'a status in the body',
      init: {
        method: 'POST',
        body: JSON.stringify({
          id: rid('p'), type: 'text', text: 'Forged', visibility: 'group',
          status: 'approved', role: 'admin', userId: admin.id,
        }),
      },
    },
  ]
  for (const { label, init } of forged) {
    const attempt = await call(waiting, '/api/data/social/posts', init as RequestInit)
    check(`${label} is ignored`, attempt.status === 403, attempt.status)
  }
  const forgedQuery = await call(waiting, `/api/data/profile?userId=${admin.id}&status=approved`)
  check('a userId in the query string is ignored', forgedQuery.status === 403, forgedQuery.status)
  check(
    'and none of that changed the row',
    query<{ role: string; status: string }>(`SELECT role, status FROM users WHERE id='${waiting.id}';`)[0]
      ?.status === 'pending',
  )

  const atAdmin = await call(waiting, '/api/admin/accounts')
  check('the admin routes refuse it as well', atAdmin.status === 403, atAdmin.status)
  const selfApprove = await call(waiting, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: waiting.id, status: 'approved' }),
  })
  check('and it certainly cannot approve itself', selfApprove.status === 403, selfApprove.status)
  check(
    'still pending',
    query<{ status: string }>(`SELECT status FROM users WHERE id='${waiting.id}';`)[0]?.status === 'pending',
  )

  head('An approval takes effect on the session that is already open')

  const queue = await call(admin, '/api/admin/accounts?status=pending')
  check('the administrator sees it waiting', queue.status === 200, queue.status)
  check(
    'in the queue',
    (queue.body.accounts as { id: string }[]).some((account) => account.id === waiting.id),
  )

  const approve = await call(admin, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: waiting.id, status: 'approved' }),
  })
  check('the approval is accepted', approve.status === 200, approve.status)

  /*
   * The same cookie, unchanged, on the next request. Nobody signed in again
   * and nothing was re-issued: the guard re-reads `users.status` on every
   * call, so the decision is in force from the next request onwards. That is
   * what lets the waiting screen become the application without a reload.
   */
  const nowIn = await call(waiting, '/api/data/profile')
  check('the very same cookie now works', nowIn.status === 200, nowIn.status)
  const nowSession = await call(waiting, '/api/auth/get-session')
  check(
    'and the session reports the new status without signing in again',
    (nowSession.body.user as { status?: string } | undefined)?.status === 'approved',
    (nowSession.body.user as { status?: string } | undefined)?.status,
  )
  check(
    'it is still a member — approval is not promotion',
    (nowSession.body.user as { role?: string } | undefined)?.role === 'member',
    (nowSession.body.user as { role?: string } | undefined)?.role,
  )

  const posted = await call(waiting, '/api/data/social/posts', {
    method: 'POST',
    body: JSON.stringify({ id: rid('p'), type: 'text', text: 'Approved probe', visibility: 'group' }),
  })
  check('and it can use the application', posted.status === 200 || posted.status === 201, posted.status)

  head('Disabling closes the door and changes the lock')

  const disabled = await signUp('disabled')
  sql(`UPDATE users SET status='approved' WHERE id='${disabled.id}';`)
  const worked = await call(disabled, '/api/data/profile')
  check('it worked while approved', worked.status === 200, worked.status)

  const disable = await call(admin, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: disabled.id, status: 'disabled' }),
  })
  check('the administrator can disable it', disable.status === 200, disable.status)
  const afterDisable = await call(disabled, '/api/data/profile')
  check('the open session stops immediately', afterDisable.status === 401, afterDisable.status)
  check(
    'because its sessions were deleted, not left to expire',
    query<{ n: number }>(`SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='${disabled.id}';`)[0]?.n === 0,
  )
  const reopen = await call(disabled, '/api/auth/get-session')
  check(
    'and reopening an old session resolves to nobody',
    reopen.status !== 200 || !reopen.body.user,
    { status: reopen.status, user: Boolean(reopen.body.user) },
  )
  const signInAgain = await send(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API },
    body: JSON.stringify({ email: disabled.email, password: PASSWORD }),
  })
  const reCookie = (signInAgain.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(';')[0].trim())
    .join('; ')
  const reSignedIn = await call({ ...disabled, cookie: reCookie }, '/api/data/profile')
  check('signing in again gets a session that still cannot do anything', reSignedIn.status === 403, reSignedIn.status)

  head('An administrator cannot use any of this on themselves')

  for (const status of ['rejected', 'disabled', 'approved'] as const) {
    const onSelf = await call(admin, '/api/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({ userId: admin.id, status }),
    })
    check(`self-${status} is refused`, onSelf.status === 403, onSelf.status)
  }
  const adminRow = query<{ role: string; status: string }>(
    `SELECT role, status FROM users WHERE id='${admin.id}';`,
  )[0]
  check('and the administrator is untouched', adminRow?.role === 'admin' && adminRow?.status === 'approved', adminRow)

  head('Cleaning up')

  for (const account of [admin, waiting, disabled]) {
    sql(`DELETE FROM users WHERE id='${account.id}';`)
  }
  const left = query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users WHERE email LIKE 'flow_%@circuit.test';`,
  )[0]?.n
  check('the check accounts are gone', left === 0, left)

  console.log(`\n${failures === 0 ? 'The approval gate holds.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
