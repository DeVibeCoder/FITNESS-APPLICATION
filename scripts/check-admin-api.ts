/**
 * The administrator boundary, against the running Worker.
 *
 * What matters here is not that an admin can approve somebody — it is
 * everything an admin must NOT be able to do, and everything a member must not
 * be able to become. So most of this file is refusals: a member at an admin
 * route, a forged role, a forged acting-admin id, an admin reaching for
 * somebody else's meals, an admin approving themselves.
 *
 * Runs against the development database and removes its accounts afterwards.
 *
 *   npm run db:check:admin
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

/**
 * One retry on a dropped connection.
 *
 * The local dev server closes an idle keep-alive socket now and then, which is
 * a property of running it on this machine rather than anything the API did.
 * Without this, a check fails for a reason that has nothing to do with what it
 * is checking.
 */
async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    return fetch(url, init)
  }
}

async function account(label: string, opts: { approve?: boolean; admin?: boolean } = {}): Promise<Account> {
  const email = `adm_${label}_${Date.now()}@circuit.test`
  const password = 'a-long-enough-password-1'
  const created = await send(`${API}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API },
    body: JSON.stringify({ email, password, name: `Admin check ${label}` }),
  })
  if (!created.ok) throw new Error(`sign-up failed for ${label}: ${created.status}`)
  if (opts.approve !== false) sql(`UPDATE users SET status='approved' WHERE email='${email}';`)
  if (opts.admin) sql(`UPDATE users SET role='admin' WHERE email='${email}';`)

  const signedIn = await send(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API },
    body: JSON.stringify({ email, password }),
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
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    body = { raw: raw.slice(0, 120) }
  }
  return { status: response.status, body }
}

const today = new Date().toISOString().slice(0, 10)
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

async function main() {
  const admin = await account('admin', { admin: true })
  const member = await account('member')
  const waiting = await account('waiting', { approve: false })

  head('The admin routes are closed to everyone else')
  const anon = await call(null, '/api/admin/accounts')
  check('anonymous is refused', anon.status === 401, anon.status)
  const asMember = await call(member, '/api/admin/accounts')
  check('an approved member is refused', asMember.status === 403, asMember.status)
  check('and told it is an administrator action, nothing more', asMember.body.error === 'forbidden', asMember.body)
  const memberDecides = await call(member, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: waiting.id, status: 'approved' }),
  })
  check('a member cannot approve anybody', memberDecides.status === 403, memberDecides.status)
  check(
    'and the account is still waiting',
    query<{ status: string }>(`SELECT status FROM users WHERE id='${waiting.id}';`)[0]?.status === 'pending',
  )

  head('A forged role does not make an administrator')
  const forgedRole = await call(member, '/api/admin/accounts', {
    headers: { 'x-role': 'admin', 'x-user-role': 'admin' },
  })
  check('a role in a header is ignored', forgedRole.status === 403, forgedRole.status)
  const forgedBody = await call(member, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: waiting.id, status: 'approved', role: 'admin', adminId: admin.id }),
  })
  check('a role or an adminId in the body is ignored', forgedBody.status === 403, forgedBody.status)
  check(
    'the member is still a member',
    query<{ role: string }>(`SELECT role FROM users WHERE id='${member.id}';`)[0]?.role === 'member',
  )

  head('The administrator can do the job')
  const queue = await call(admin, '/api/admin/accounts?status=pending')
  check('the queue reads', queue.status === 200, queue.status)
  const waitingList = (queue.body.accounts ?? []) as Record<string, unknown>[]
  check('and holds the waiting account', waitingList.some((row) => row.id === waiting.id))
  check('with no password material in it', waitingList.every((row) => !('password' in row) && !('token' in row)))

  const approved = await call(admin, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: waiting.id, status: 'approved' }),
  })
  check('an approval is accepted', approved.status === 200, approved.status)
  const decided = query<{ status: string; decided_by: string }>(
    `SELECT status, decided_by FROM users WHERE id='${waiting.id}';`,
  )
  check('the account is approved', decided[0]?.status === 'approved', decided[0]?.status)
  check('and the decision records who made it', decided[0]?.decided_by === admin.id)

  head('An administrator cannot decide about themselves')
  const self = await call(admin, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: admin.id, status: 'disabled' }),
  })
  check('deciding on your own account is refused', self.status === 403, self.status)
  check(
    'and the administrator is untouched',
    query<{ status: string }>(`SELECT status FROM users WHERE id='${admin.id}';`)[0]?.status === 'approved',
  )

  head('Being an administrator is not a key to anybody else')
  // The member writes a meal of their own.
  const mealId = uid('f')
  await call(member, '/api/data/nutrition/food', {
    method: 'POST',
    body: JSON.stringify({
      id: mealId, date: today, meal: 'lunch', name: "Member's own lunch", portion: '1',
      kcal: 500, proteinG: 30, carbsG: 50, fatG: 15, source: 'manual',
    }),
  })
  const adminSees = ((await call(admin, '/api/data/nutrition/food')).body.rows ?? []) as Record<string, unknown>[]
  check("the admin's own food list does not contain the member's meal", !adminSees.some((row) => row.id === mealId))
  const adminDeletes = await call(admin, `/api/data/nutrition/food/${mealId}`, { method: 'DELETE' })
  check("an admin cannot delete a member's meal", adminDeletes.status === 404, adminDeletes.status)
  check('and it is still there', query(`SELECT id FROM food_entries WHERE id='${mealId}';`).length === 1)

  const adminAsMember = await call(admin, `/api/data/nutrition/food?userId=${member.id}`)
  const spied = ((adminAsMember.body.rows ?? []) as Record<string, unknown>[])
  check('asking for another user by query parameter changes nothing', !spied.some((row) => row.id === mealId))

  const adminProfileEdit = await call(admin, '/api/data/profile', {
    method: 'PATCH',
    body: JSON.stringify({ id: member.id, userId: member.id, name: 'Renamed by admin' }),
  })
  check('a profile PATCH names no target', adminProfileEdit.status === 200, adminProfileEdit.status)
  check(
    "and the member's name is unchanged",
    query<{ name: string }>(`SELECT name FROM users WHERE id='${member.id}';`)[0]?.name !== 'Renamed by admin',
  )
  check(
    "the admin renamed themselves instead",
    query<{ name: string }>(`SELECT name FROM users WHERE id='${admin.id}';`)[0]?.name === 'Renamed by admin',
  )

  head('A rejected account loses its way in')
  const rejected = await account('rejected')
  const before = await call(rejected, '/api/data/profile')
  check('it works while approved', before.status === 200, before.status)
  await call(admin, '/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ userId: rejected.id, status: 'rejected' }),
  })
  const after = await call(rejected, '/api/data/profile')
  check('and stops the moment it is rejected', after.status === 401 || after.status === 403, after.status)
  check(
    'its sessions were removed rather than left to expire',
    query(`SELECT id FROM auth_sessions WHERE user_id='${rejected.id}';`).length === 0,
  )

  head('Cleaning up')
  sql(`DELETE FROM users WHERE email LIKE 'adm_%@circuit.test';`)
  check('the check accounts are gone', query(`SELECT id FROM users WHERE email LIKE 'adm_%@circuit.test';`).length === 0)
  check('and their data went with them', query(`SELECT id FROM food_entries WHERE id='${mealId}';`).length === 0)

  console.log(`\n${failures === 0 ? 'The administrator boundary holds.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
