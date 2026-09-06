/**
 * The migrated domains, against the running Worker.
 *
 * This is not a unit test of the repositories — it drives the real HTTP
 * routes with real session cookies, because the things most worth proving
 * here are the ones a mocked database cannot show: that an anonymous caller
 * is refused, that a forged `userId` in a body changes nothing, and that two
 * accounts cannot see each other's rows.
 *
 * It creates two throwaway accounts in the development database, proves what
 * it needs to, and removes them and everything they wrote. It never touches
 * production — the connection it uses is the local dev D1, and the only
 * commands it runs against it are the two at the end that clean up.
 *
 *   npm run db:check:data
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
    `${WRANGLER} d1 execute circuit-dev --env preview --local --json --command "${command.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 8e6, stdio: ['ignore', 'pipe', 'ignore'] },
  )

const query = <T>(command: string): T[] => {
  const out = sql(command)
  return (JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[]).flatMap((b) => b.results ?? [])
}

/** One signed-in account, holding its own cookie. Nothing else identifies it. */
interface Account {
  email: string
  id: string
  cookie: string
}

async function signUp(label: string, approve = true): Promise<Account> {
  const email = `data_${label}_${Date.now()}@circuit.test`
  const password = 'a-long-enough-password-1'
  const created = await fetch(`${API}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API },
    body: JSON.stringify({ email, password, name: `Data ${label}` }),
  })
  if (!created.ok) throw new Error(`sign-up failed for ${label}: ${created.status}`)
  if (approve) sql(`UPDATE users SET status='approved' WHERE email='${email}';`)

  const signedIn = await fetch(`${API}/api/auth/sign-in/email`, {
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

const callAs = async (
  account: Account | null,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const send = () =>
    fetch(`${API}/api/data${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(account ? { Cookie: account.cookie } : {}),
        ...(init.headers ?? {}),
      },
    })
  // The local dev server drops an idle keep-alive socket now and then, which
  // is a property of running it on this machine rather than anything the API
  // did. One retry, so a dropped connection is not read as a failed check.
  let response: Response
  try {
    response = await send()
  } catch {
    response = await send()
  }
  const raw = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    body = { raw: raw.slice(0, 120) }
  }
  return { status: response.status, body }
}

const rowsOf = (body: Record<string, unknown>) => (body.rows ?? []) as Record<string, unknown>[]
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const today = new Date().toISOString().slice(0, 10)

async function main() {
  const alice = await signUp('alice')
  const bob = await signUp('bob')
  const waiting = await signUp('waiting', false)

  head('Nobody gets in without a session')
  for (const path of [
    '/profile',
    '/nutrition/food',
    '/nutrition/weights',
    '/social/posts',
    '/social/notifications',
    '/chat/messages',
  ]) {
    const anon = await callAs(null, path)
    check(`anonymous is refused from ${path}`, anon.status === 401, anon.status)
  }
  const anonWrite = await callAs(null, '/nutrition/food', {
    method: 'POST',
    body: JSON.stringify({ id: uid('f'), date: today, meal: 'lunch', name: 'x', portion: '1', kcal: 1, proteinG: 0, carbsG: 0, fatG: 0, source: 'manual' }),
  })
  check('and cannot write either', anonWrite.status === 401, anonWrite.status)

  head('An account still waiting for approval is not in yet')
  const pending = await callAs(waiting, '/nutrition/food')
  check('a pending account is refused', pending.status === 403, pending.status)
  check('and is told why, without detail it cannot act on', pending.body.error === 'pending', pending.body)

  head('Nutrition, weight, steps and check-ins round-trip')
  const foodId = uid('f')
  const wrote = await callAs(alice, '/nutrition/food', {
    method: 'POST',
    body: JSON.stringify({
      id: foodId, date: today, meal: 'lunch', name: 'Rice and dal', portion: '250 g',
      quantity: 250, unit: 'g', kcal: 420, proteinG: 18, carbsG: 62, fatG: 9, source: 'manual',
    }),
  })
  check('a meal is accepted', wrote.status === 200, wrote.status)
  const food = rowsOf((await callAs(alice, '/nutrition/food')).body)
  check('and reads back', food.length === 1 && food[0].name === 'Rice and dal', food[0]?.name)
  check('owned by the account that wrote it', food[0]?.user_id === alice.id)
  check('with its macros intact', food[0]?.kcal === 420 && food[0]?.protein_g === 18)

  const weightId = uid('w')
  await callAs(alice, '/nutrition/weights', {
    method: 'POST',
    body: JSON.stringify({ id: weightId, date: today, weightKg: 78.4 }),
  })
  await callAs(alice, '/nutrition/steps', {
    method: 'POST',
    body: JSON.stringify({ id: uid('st'), date: today, steps: 9120 }),
  })
  await callAs(alice, '/nutrition/checkins', {
    method: 'POST',
    body: JSON.stringify({ id: uid('ci'), date: today, energy: 3, mood: 4, soreness: 'low' }),
  })
  await callAs(alice, '/nutrition/water', {
    method: 'POST',
    body: JSON.stringify({ id: uid('h2o'), date: today, ml: 250 }),
  })
  check('a weigh-in reads back', rowsOf((await callAs(alice, '/nutrition/weights')).body)[0]?.weight_kg === 78.4)
  check('steps read back', rowsOf((await callAs(alice, '/nutrition/steps')).body)[0]?.steps === 9120)
  check('a check-in reads back', rowsOf((await callAs(alice, '/nutrition/checkins')).body)[0]?.energy === 3)
  check('water reads back', rowsOf((await callAs(alice, '/nutrition/water')).body)[0]?.ml === 250)

  head('Correcting a day corrects it, rather than adding another')
  await callAs(alice, '/nutrition/weights', {
    method: 'POST',
    body: JSON.stringify({ id: weightId, date: today, weightKg: 78.1 }),
  })
  const weights = rowsOf((await callAs(alice, '/nutrition/weights')).body)
  check('still one weigh-in for the day', weights.length === 1, weights.length)
  check('and it is the corrected number', weights[0]?.weight_kg === 78.1, weights[0]?.weight_kg)

  head('Two people offering the same id is not a failed save')
  /*
   * Client ids are unique on the device that made them, not across the group.
   * Two devices restored from the same starting data will offer the same id,
   * and the second one to arrive must not be refused a save it had every right
   * to make, nor be allowed to write over the first.
   */
  const shared = uid('w')
  await callAs(alice, '/nutrition/weights', {
    method: 'POST',
    body: JSON.stringify({ id: shared, date: '2026-01-05', weightKg: 70 }),
  })
  const clash = await callAs(bob, '/nutrition/weights', {
    method: 'POST',
    body: JSON.stringify({ id: shared, date: '2026-01-05', weightKg: 91 }),
  })
  check('the second write is accepted', clash.status === 200, clash.status)
  const both = query<{ id: string; user_id: string; weight_kg: number }>(
    `SELECT id, user_id, weight_kg FROM weights WHERE date='2026-01-05';`,
  )
  check('and both people have their own row', both.length === 2, both.length)
  check("Alice's number is untouched", both.some((row) => row.user_id === alice.id && row.weight_kg === 70), both)
  check('and Bob has his own', both.some((row) => row.user_id === bob.id && row.weight_kg === 91))

  head('A forged owner in the body is ignored')
  const forgedId = uid('f')
  await callAs(alice, '/nutrition/food', {
    method: 'POST',
    body: JSON.stringify({
      id: forgedId, userId: bob.id, user_id: bob.id, ownerId: bob.id, role: 'admin', status: 'approved',
      date: today, meal: 'dinner', name: 'Forged', portion: '1', kcal: 10, proteinG: 0, carbsG: 0, fatG: 0, source: 'manual',
    }),
  })
  const forged = query<{ user_id: string }>(`SELECT user_id FROM food_entries WHERE id='${forgedId}';`)
  check('the row belongs to the session, not the body', forged[0]?.user_id === alice.id, forged[0]?.user_id)
  check('and Bob does not see it', !rowsOf((await callAs(bob, '/nutrition/food')).body).some((r) => r.id === forgedId))
  const bobRole = query<{ role: string; status: string }>(`SELECT role, status FROM users WHERE id='${alice.id}';`)
  check('a role in a body does not promote anybody', bobRole[0]?.role === 'member', bobRole[0]?.role)

  head('One account cannot read or delete another')
  check("Bob's food list is his own", rowsOf((await callAs(bob, '/nutrition/food')).body).length === 0)
  const stealDelete = await callAs(bob, `/nutrition/food/${foodId}`, { method: 'DELETE' })
  check("Bob cannot delete Alice's meal", stealDelete.status === 404, stealDelete.status)
  check('and it is still there', query(`SELECT id FROM food_entries WHERE id='${foodId}';`).length === 1)

  const stealWrite = await callAs(bob, '/nutrition/food', {
    method: 'POST',
    body: JSON.stringify({
      id: foodId, date: today, meal: 'dinner', name: 'Overwritten by Bob', portion: '1',
      kcal: 1, proteinG: 0, carbsG: 0, fatG: 0, source: 'manual',
    }),
  })
  const afterSteal = query<{ name: string; user_id: string }>(`SELECT name, user_id FROM food_entries WHERE id='${foodId}';`)
  check("Bob's write to Alice's id is refused or ignored", stealWrite.status === 200 || stealWrite.status === 403)
  check("and Alice's meal is untouched", afterSteal[0]?.name === 'Rice and dal', afterSteal[0]?.name)
  check('and still hers', afterSteal[0]?.user_id === alice.id)

  head('Bad input is refused by name, and the database is never told')
  const bad = await callAs(alice, '/nutrition/weights', {
    method: 'POST',
    body: JSON.stringify({ id: uid('w'), date: 'not-a-date', weightKg: 70 }),
  })
  check('a broken date is a 400', bad.status === 400, bad.status)
  check('naming the field', bad.body.field === 'date', bad.body)
  const impossible = await callAs(alice, '/nutrition/weights', {
    method: 'POST',
    body: JSON.stringify({ id: uid('w'), date: '2026-02-31', weightKg: 70 }),
  })
  check('a date that does not exist is a 400', impossible.status === 400, impossible.status)
  const absurd = await callAs(alice, '/nutrition/steps', {
    method: 'POST',
    body: JSON.stringify({ id: uid('st'), date: today, steps: 99999999 }),
  })
  check('an impossible step count is a 400', absurd.status === 400, absurd.status)
  const injected = await callAs(alice, `/nutrition/food/${encodeURIComponent("x' OR '1'='1")}`, { method: 'DELETE' })
  check('an id shaped like SQL is refused, not run', injected.status === 400 || injected.status === 404, injected.status)
  check('and nothing was deleted', query(`SELECT id FROM food_entries WHERE id='${foodId}';`).length === 1)

  head('Social: the group reads together, the author writes alone')
  const postId = uid('p')
  await callAs(alice, '/social/posts', {
    method: 'POST',
    body: JSON.stringify({ id: postId, type: 'text', text: 'Morning run done', visibility: 'group' }),
  })
  const bobSees = rowsOf((await callAs(bob, '/social/posts')).body)
  check("Bob can read Alice's post", bobSees.some((row) => row.id === postId))
  const bobDeletes = await callAs(bob, `/social/posts/${postId}`, { method: 'DELETE' })
  check('but cannot delete it', bobDeletes.status === 404, bobDeletes.status)

  await callAs(bob, '/social/comments', {
    method: 'POST',
    body: JSON.stringify({ id: uid('c'), postId, text: 'Nice one' }),
  })
  const commented = rowsOf((await callAs(alice, '/social/posts')).body).find((row) => row.id === postId)
  check("a comment moves the post's count", commented?.comment_count === 1, commented?.comment_count)
  await callAs(bob, '/social/post-reactions', {
    method: 'POST',
    body: JSON.stringify({ id: uid('pr'), targetId: postId, emoji: '🔥' }),
  })
  const reacted = rowsOf((await callAs(alice, '/social/posts')).body).find((row) => row.id === postId)
  check('and a reaction moves its count', reacted?.motivation === 1, reacted?.motivation)
  await callAs(bob, '/social/post-reactions', {
    method: 'POST',
    body: JSON.stringify({ id: uid('pr'), targetId: postId, emoji: '' }),
  })
  const unreacted = rowsOf((await callAs(alice, '/social/posts')).body).find((row) => row.id === postId)
  check('taking it back off moves it back', unreacted?.motivation === 0, unreacted?.motivation)

  head('An announcement happens once, however many times it is sent')
  const key = `workout:${uid('ws')}`
  const first = await callAs(alice, '/social/updates', {
    method: 'POST',
    body: JSON.stringify({ id: uid('up'), kind: 'workout_completed', text: 'completed Legs 💪', dedupeKey: key }),
  })
  const second = await callAs(alice, '/social/updates', {
    method: 'POST',
    body: JSON.stringify({ id: uid('up'), kind: 'workout_completed', text: 'completed Legs 💪', dedupeKey: key }),
  })
  const announced = query(`SELECT id FROM group_updates WHERE dedupe_key='${key}';`)
  check('the same event announces once', announced.length === 1, announced.length)
  check('and both calls answer with the same row', (first.body.row as { id: string })?.id === (second.body.row as { id: string })?.id)

  head('Notifications are addressed, not broadcast')
  const noteId = uid('n')
  await callAs(alice, '/social/notifications', {
    method: 'POST',
    body: JSON.stringify({ id: noteId, kind: 'reaction', text: 'Bob reacted to your post' }),
  })
  check('Alice sees hers', rowsOf((await callAs(alice, '/social/notifications')).body).length === 1)
  check('Bob sees none of them', rowsOf((await callAs(bob, '/social/notifications')).body).length === 0)
  await callAs(alice, '/social/notifications-read', { method: 'POST', body: JSON.stringify({ ids: [noteId] }) })
  const read = rowsOf((await callAs(alice, '/social/notifications')).body)[0]
  check('marking read sticks', Boolean(read?.read_at), read?.read_at)

  head('Awards are earned once, and reference data stays reference data')
  const awardId = uid('ua')
  const earned = await callAs(alice, '/social/awards', {
    method: 'POST',
    body: JSON.stringify({ id: awardId, achievementKey: 'first_workout' }),
  })
  check('an award is recorded', earned.status === 200, earned.status)
  await callAs(alice, '/social/awards', {
    method: 'POST',
    body: JSON.stringify({ id: uid('ua'), achievementKey: 'first_workout' }),
  })
  check('earning it twice is still once', rowsOf((await callAs(alice, '/social/awards')).body).length === 1)
  const unknown = await callAs(alice, '/social/awards', {
    method: 'POST',
    body: JSON.stringify({ id: uid('ua'), achievementKey: 'no_such_award' }),
  })
  check('an award the catalogue does not have is refused', unknown.status === 404, unknown.status)
  check('and Bob has none of hers', rowsOf((await callAs(bob, '/social/awards')).body).length === 0)
  check(
    'the catalogue itself was not written to',
    query(`SELECT key FROM achievement_definitions WHERE key='no_such_award';`).length === 0,
  )

  head('Chat: one group, and only the author edits a message')
  const messageId = uid('msg')
  await callAs(alice, '/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ id: messageId, text: 'Anyone training tonight?' }),
  })
  const bobReads = rowsOf((await callAs(bob, '/chat/messages')).body)
  check("Bob sees Alice's message", bobReads.some((row) => row.id === messageId))
  const members = ((await callAs(bob, '/chat/members')).body.members ?? []) as { id: string }[]
  // That he is in it, not how many are — the group is shared, and a count is
  // a fact about whoever else has ever run this, not about joining.
  check('and reading the chat put him in the group', members.some((one) => one.id === bob.id))
  check('as did Alice when she sent hers', members.some((one) => one.id === alice.id))
  const bobDeletesMessage = await callAs(bob, `/chat/messages/${messageId}`, { method: 'DELETE' })
  check("Bob cannot delete Alice's message", bobDeletesMessage.status === 404, bobDeletesMessage.status)
  await callAs(alice, `/chat/messages/${messageId}`, { method: 'DELETE' })
  const deleted = query<{ deleted_at: string | null; text: string }>(
    `SELECT deleted_at, text FROM messages WHERE id='${messageId}';`,
  )
  check('the author can, and it is soft', Boolean(deleted[0]?.deleted_at), deleted[0]?.deleted_at)
  check('with the words cleared', deleted[0]?.text === '', deleted[0]?.text)

  head('Profile: your own, and not your own status')
  const before = query<{ role: string; status: string }>(`SELECT role, status FROM users WHERE id='${alice.id}';`)
  const patched = await callAs(alice, '/profile', {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Alice Renamed', stepGoal: 11000, role: 'admin', status: 'approved', id: bob.id }),
  })
  check('the profile updates', patched.status === 200, patched.status)
  const after = query<{ name: string; step_goal: number; role: string; status: string }>(
    `SELECT name, step_goal, role, status FROM users WHERE id='${alice.id}';`,
  )
  check('the name changed', after[0]?.name === 'Alice Renamed', after[0]?.name)
  check('the goal changed', after[0]?.step_goal === 11000, after[0]?.step_goal)
  check('the role did not', after[0]?.role === before[0]?.role, after[0]?.role)
  check('the status did not', after[0]?.status === before[0]?.status, after[0]?.status)
  check("and Bob's row was not the one edited", query<{ name: string }>(`SELECT name FROM users WHERE id='${bob.id}';`)[0]?.name === 'Data bob')

  const roster = ((await callAs(alice, '/roster')).body.users ?? []) as Record<string, unknown>[]
  check('the roster lists approved members', roster.length >= 2, roster.length)
  check('and carries no email', roster.every((row) => !('email' in row)))
  check('no role and no status', roster.every((row) => !('role' in row) && !('status' in row)))

  head('Media is referenced, never embedded')
  const embedded = await callAs(alice, '/media', {
    method: 'POST',
    body: JSON.stringify({ id: uid('m'), kind: 'image', ref: `data:image/png;base64,${'A'.repeat(200)}`, mimeType: 'image/png' }),
  })
  check('a data URI is refused', embedded.status === 400, embedded.status)
  const upload = await callAs(alice, '/media/upload', { method: 'POST', body: JSON.stringify({}) })
  check('and uploading says storage is not switched on', upload.status === 503, upload.status)
  check('with a reason a client can branch on', upload.body.reason === 'r2_not_enabled', upload.body)

  head('Nothing leaks in a failure')
  const broken = await callAs(alice, '/social/comments', {
    method: 'POST',
    body: JSON.stringify({ id: uid('c'), postId: 'nope_does_not_exist', text: 'orphan' }),
  })
  const said = JSON.stringify(broken.body)
  check('a database failure does not describe the database', !/SQLITE|FOREIGN KEY|constraint|no such/i.test(said), said.slice(0, 120))
  check('and no token or secret is in any response', !/AUTH_SECRET|session_token|Bearer /i.test(said))

  head('Cleaning up')
  sql(`DELETE FROM users WHERE email LIKE 'data_%@circuit.test';`)
  const left = query(`SELECT id FROM users WHERE email LIKE 'data_%@circuit.test';`)
  check('the test accounts are gone', left.length === 0, left.length)
  check('their food went with them', query(`SELECT id FROM food_entries WHERE id='${foodId}';`).length === 0)
  check('their posts went with them', query(`SELECT id FROM posts WHERE id='${postId}';`).length === 0)
  check('their messages went with them', query(`SELECT id FROM messages WHERE id='${messageId}';`).length === 0)

  console.log(`\n${failures === 0 ? 'The data API holds.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
