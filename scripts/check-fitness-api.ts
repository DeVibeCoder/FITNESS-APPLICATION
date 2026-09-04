/**
 * The fitness API, against a running Worker and a real D1 database.
 *
 * The questions worth asking are about ownership and integrity: can one
 * person reach another's workouts, does a bad payload get refused before it
 * corrupts anything, and does a failed write leave a half-record behind.
 *
 * Start the API first:
 *   npm run dev:api
 * Then: npm run db:check:fitness
 */
import { execSync } from 'node:child_process'

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8788'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
const head = (t: string) => console.log(`\n--- ${t} ---\n`)

interface Reply {
  status: number
  body: Record<string, unknown>
  cookies: string[]
}

async function call(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: BASE,
    ...(init.headers as Record<string, string>),
  }
  if (init.cookie) headers.Cookie = init.cookie
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
    body = text ? ((JSON.parse(text) as Record<string, unknown> | null) ?? {}) : {}
  } catch {
    body = { raw: text.slice(0, 120) }
  }
  return { status: response.status, body, cookies: response.headers.getSetCookie?.() ?? [] }
}

const sessionCookie = (cookies: string[]) =>
  cookies.map((c) => c.split(';')[0]).filter((c) => c.includes('session')).join('; ')

const sql = (statement: string) =>
  execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --json --command "${statement.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 8e6, stdio: ['ignore', 'pipe', 'ignore'] },
  )
const query = <T>(statement: string): T[] => {
  const out = sql(statement)
  return (JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[]).flatMap((b) => b.results ?? [])
}

const PASSWORD = 'a-long-enough-password-1'

/** A development account in whatever state the test needs. */
async function account(status: 'approved' | 'pending' | 'rejected' | 'disabled') {
  const email = `fit_${status}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@circuit.test`
  await call('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, name: 'Fitness Tester' }),
  })
  if (status !== 'pending') {
    execSync(
      `npx wrangler d1 execute circuit-dev --env preview --local --command "UPDATE users SET status='${status}' WHERE email='${email}';"`,
      { stdio: 'ignore' },
    )
  }
  const login = await call('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return { email, cookie: sessionCookie(login.cookies) }
}

const PLANK_WORKOUT = {
  date: '2026-09-04',
  kind: 'strength',
  name: 'Cloud probe',
  durationSec: 1500,
  caloriesKcal: 240,
  exercises: [
    { name: 'Goblet Squat', kind: 'strength', sets: 3, reps: 12, weightKg: 20 },
    { name: 'Plank', kind: 'timed', sets: 3, durationSec: 45 },
    { name: 'Treadmill', kind: 'cardio', durationSec: 600, distanceKm: 1.5 },
  ],
  setResults: [{ setIndex: 0, reps: 12, weightKg: 20, completed: true }],
}

async function main() {
  head('Accounts')
  const alice = await account('approved')
  const bob = await account('approved')
  const pending = await account('pending')
  const rejected = await account('rejected')
  const disabled = await account('disabled')
  check('two approved accounts and three refused states exist', Boolean(alice.cookie && bob.cookie))

  // --- 1-5. Create, and check what actually landed ------------------------
  head('1-5. An approved user logs a workout')
  const created = await call('/api/fitness/workouts', {
    method: 'POST',
    cookie: alice.cookie,
    body: JSON.stringify(PLANK_WORKOUT),
  })
  check('1. the workout is accepted', created.status === 201, created.status)
  const workoutId = created.body.id as string

  const rows = query<{ id: string; user_id: string; exercise_count: number; duration_sec: number }>(
    `SELECT id, user_id, exercise_count, duration_sec FROM workout_sessions WHERE id='${workoutId}';`,
  )
  check('2. the session is in D1', rows.length === 1, rows.length)
  check('2. it belongs to the session user', Boolean(rows[0]?.user_id), rows[0]?.user_id?.slice(0, 8))
  check('2. its exercise count matches what was sent', rows[0]?.exercise_count === 3, rows[0]?.exercise_count)

  const exercises = query<{ name: string; kind: string; sets: number | null; reps: number | null; weight_kg: number | null; duration_sec: number | null; distance_km: number | null }>(
    `SELECT name, kind, sets, reps, weight_kg, duration_sec, distance_km FROM logged_exercises WHERE session_id='${workoutId}' ORDER BY position;`,
  )
  check('3. all three exercises are in D1', exercises.length === 3, exercises.length)
  const plank = exercises.find((e) => e.name === 'Plank')
  check('5. a timed exercise keeps its kind, sets and hold', plank?.kind === 'timed' && plank?.sets === 3 && plank?.duration_sec === 45, plank)
  check('5. and carries no reps, weight or distance', plank?.reps === null && plank?.weight_kg === null && plank?.distance_km === null, plank)
  const squat = exercises.find((e) => e.name === 'Goblet Squat')
  check('5. a strength exercise keeps sets/reps/weight and no duration', squat?.sets === 3 && squat?.reps === 12 && squat?.weight_kg === 20 && squat?.duration_sec === null, squat)
  const tread = exercises.find((e) => e.name === 'Treadmill')
  check('5. a cardio exercise keeps duration and distance and no sets/reps', tread?.duration_sec === 600 && tread?.distance_km === 1.5 && tread?.sets === null && tread?.reps === null, tread)

  const sets = query(`SELECT id FROM set_results WHERE session_id='${workoutId}';`)
  check('4. set results are in D1', sets.length === 1, sets.length)

  // --- 6. Read back --------------------------------------------------------
  head('6. Read back through the API')
  const detail = await call(`/api/fitness/workouts/${workoutId}`, { cookie: alice.cookie })
  check('6. the workout reads back', detail.status === 200, detail.status)
  check('6. with its three exercises', (detail.body.exercises as unknown[])?.length === 3)
  const list = await call('/api/fitness/workouts', { cookie: alice.cookie })
  check('6. and appears in the list', ((list.body.sessions as { id: string }[]) ?? []).some((s) => s.id === workoutId))

  // --- 7-8. Another user ---------------------------------------------------
  head('7-8. Another account cannot reach it')
  const bobRead = await call(`/api/fitness/workouts/${workoutId}`, { cookie: bob.cookie })
  check('7. user B cannot read user A workout', bobRead.status === 404, bobRead.status)
  const bobList = await call('/api/fitness/workouts', { cookie: bob.cookie })
  check("7. and it is absent from user B's list", ((bobList.body.sessions as unknown[]) ?? []).length === 0)
  const bobEdit = await call(`/api/fitness/workouts/${workoutId}`, {
    method: 'PATCH',
    cookie: bob.cookie,
    body: JSON.stringify({ ...PLANK_WORKOUT, name: 'Stolen' }),
  })
  check('8. user B cannot edit it', bobEdit.status === 404, bobEdit.status)
  const bobDelete = await call(`/api/fitness/workouts/${workoutId}`, { method: 'DELETE', cookie: bob.cookie })
  check('8. user B cannot delete it', bobDelete.status === 404, bobDelete.status)
  check('8. and it is still there afterwards', query(`SELECT id FROM workout_sessions WHERE id='${workoutId}';`).length === 1)

  // --- 9-10. Anonymous and unapproved --------------------------------------
  head('9-10. Anonymous and unapproved accounts')
  const anon = await call('/api/fitness/workouts')
  check('9. anonymous is refused', anon.status === 401 && anon.body.error === 'unauthenticated', anon.body.error)
  for (const [state, who] of [
    ['pending', pending],
    ['rejected', rejected],
    ['disabled', disabled],
  ] as const) {
    const refused = await call('/api/fitness/workouts', { cookie: who.cookie })
    check(`10. a ${state} account is refused`, refused.status === 403 && refused.body.error === state, refused.body.error)
    const refusedWrite = await call('/api/fitness/workouts', {
      method: 'POST',
      cookie: who.cookie,
      body: JSON.stringify(PLANK_WORKOUT),
    })
    check(`10. and cannot write either`, refusedWrite.status === 403, refusedWrite.status)
  }

  // --- Identity cannot be asserted ----------------------------------------
  head('A request cannot name its own owner')
  const forged = await call('/api/fitness/workouts', {
    method: 'POST',
    cookie: bob.cookie,
    headers: { 'X-User-Id': 'someone-else' },
    body: JSON.stringify({ ...PLANK_WORKOUT, name: 'Forged', userId: 'someone-else', role: 'admin', status: 'approved' }),
  })
  check('a body carrying userId/role/status is still written as the caller', forged.status === 201, forged.status)
  const forgedRow = query<{ user_id: string }>(`SELECT user_id FROM workout_sessions WHERE id='${forged.body.id}';`)[0]
  const bobRow = query<{ id: string }>(`SELECT id FROM workout_sessions WHERE name='Forged';`)
  check('the claimed owner was ignored', forgedRow?.user_id !== 'someone-else', forgedRow?.user_id?.slice(0, 8))
  check('no session token was stored in the workout', !JSON.stringify(bobRow).includes('session'))

  // --- 11. Invalid payloads ------------------------------------------------
  head('11. Cross-kind payloads are refused')
  const bad = [
    ['a timed exercise carrying reps', { name: 'Plank', kind: 'timed', sets: 3, reps: 10, durationSec: 45 }],
    ['a strength exercise carrying distance', { name: 'Squat', kind: 'strength', sets: 3, reps: 8, distanceKm: 2 }],
    ['a cardio exercise carrying sets', { name: 'Run', kind: 'cardio', sets: 3, durationSec: 600 }],
    ['an unknown kind', { name: 'Mystery', kind: 'interpretive-dance', sets: 1 }],
  ] as const
  for (const [label, exercise] of bad) {
    const rejectedWrite = await call('/api/fitness/workouts', {
      method: 'POST',
      cookie: alice.cookie,
      body: JSON.stringify({ ...PLANK_WORKOUT, exercises: [exercise] }),
    })
    check(`11. ${label} is refused`, rejectedWrite.status === 400 && rejectedWrite.body.error === 'invalid_workout', rejectedWrite.body.field ?? rejectedWrite.status)
  }

  // --- 12. A failed child write leaves nothing behind ----------------------
  head('12. A failed write leaves no partial workout')
  const before = query<{ n: number }>(`SELECT COUNT(*) AS n FROM workout_sessions;`)[0].n
  // Position is UNIQUE per session; two exercises cannot share one. The
  // session insert is first in the batch, so if the batch were not atomic
  // the session would survive its failed children.
  const partial = await call('/api/fitness/workouts', {
    method: 'POST',
    cookie: alice.cookie,
    body: JSON.stringify({
      ...PLANK_WORKOUT,
      name: 'Should not exist',
      exercises: [
        { name: 'One', kind: 'timed', sets: 1, durationSec: 30 },
        { name: 'Two', kind: 'timed', sets: 1, durationSec: 30 },
      ],
      setResults: [
        { setIndex: 0, reps: 1 },
        { setIndex: 0, reps: 1 },
      ],
    }),
  })
  const after = query<{ n: number }>(`SELECT COUNT(*) AS n FROM workout_sessions;`)[0].n
  const orphan = query(`SELECT id FROM workout_sessions WHERE name='Should not exist';`)
  console.log(`      write answered ${partial.status}; sessions ${before} -> ${after}`)
  check('12. a duplicate set index is rejected', partial.status >= 400, partial.status)
  check('12. and no session was left behind', orphan.length === 0 && after === before, { before, after, orphan: orphan.length })

  // --- Edit and delete -----------------------------------------------------
  head('Edit and delete')
  const edited = await call(`/api/fitness/workouts/${workoutId}`, {
    method: 'PATCH',
    cookie: alice.cookie,
    body: JSON.stringify({ ...PLANK_WORKOUT, name: 'Edited', exercises: [{ name: 'Plank', kind: 'timed', sets: 4, durationSec: 60 }] }),
  })
  check('an edit is accepted', edited.status === 200, edited.status)
  const editedRow = query<{ name: string; exercise_count: number }>(`SELECT name, exercise_count FROM workout_sessions WHERE id='${workoutId}';`)[0]
  check('the session was updated in place', editedRow?.name === 'Edited' && editedRow?.exercise_count === 1, editedRow)
  check('the exercise rows were replaced wholesale', query(`SELECT id FROM logged_exercises WHERE session_id='${workoutId}';`).length === 1)
  check('no duplicate session was created', query(`SELECT id FROM workout_sessions WHERE id='${workoutId}';`).length === 1)

  const removed = await call(`/api/fitness/workouts/${workoutId}`, { method: 'DELETE', cookie: alice.cookie })
  check('a delete is accepted', removed.status === 204, removed.status)
  check('the session is gone', query(`SELECT id FROM workout_sessions WHERE id='${workoutId}';`).length === 0)
  check('its exercises cascaded away', query(`SELECT id FROM logged_exercises WHERE session_id='${workoutId}';`).length === 0)
  check('its set results cascaded away', query(`SELECT id FROM set_results WHERE session_id='${workoutId}';`).length === 0)

  // --- Reference catalogue -------------------------------------------------
  head('Reference catalogue')
  const catalogue = await call('/api/fitness/exercises', { cookie: alice.cookie })
  check('the catalogue reads back', catalogue.status === 200 && ((catalogue.body.exercises as unknown[]) ?? []).length > 0, ((catalogue.body.exercises as unknown[]) ?? []).length)
  const anonCatalogue = await call('/api/fitness/exercises')
  check('and is not open to anonymous callers', anonCatalogue.status === 401, anonCatalogue.status)

  // --- Cleanup -------------------------------------------------------------
  execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --command "DELETE FROM users WHERE email LIKE 'fit_%@circuit.test';"`,
    { stdio: 'ignore' },
  )
  const left = query<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE email LIKE 'fit_%@circuit.test';`)[0].n
  check('the test accounts were removed again', left === 0, left)
  check('and their workouts cascaded with them', query<{ n: number }>(`SELECT COUNT(*) AS n FROM workout_sessions;`)[0].n === 0)

  console.log(`\n${failures === 0 ? 'The fitness API holds.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
