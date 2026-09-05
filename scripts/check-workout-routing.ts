/**
 * Which store a workout goes to, and when.
 *
 * The dangerous mistakes here are silent ones: writing to the cloud as
 * nobody, or quietly dropping a workout into Dexie when the user believes it
 * is on the server. This checks the decision itself, which is the part that
 * has to be right before any of the plumbing matters.
 *
 *   npm run db:check:routing
 */
import 'fake-indexeddb/auto'
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
} as Storage

import { readFileSync } from 'node:fs'
import { ensureSeeded } from '../src/data/seed'
import { db } from '../src/lib/db'
import { workoutData } from '../src/services/workoutData'
import { storageService } from '../src/services/storageService'
import { todayKey } from '../src/utils/date'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
const head = (t: string) => console.log(`\n--- ${t} ---\n`)

async function main() {
  await ensureSeeded()
  const me = (await db.users.toArray())[0]
  storageService.setSessionUserId(me.id)

  head('The default is local, and nothing opts in by itself')
  check('a fresh process routes to Dexie', workoutData.current() === 'local', workoutData.current())

  head('Local mode keeps working exactly as before')
  const before = await db.sessions.count()
  const saved = await workoutData.save({
    userId: me.id,
    date: todayKey(),
    kind: 'strength',
    name: 'Routing probe',
    durationSec: 900,
    exercises: [{ name: 'Plank', kind: 'timed', sets: 3, durationSec: 45 }],
  })
  check('a local save writes to Dexie', (await db.sessions.count()) === before + 1)
  check('and the row belongs to the local profile', saved.userId === me.id)
  const localExercises = await workoutData.exercisesFor(saved.id)
  check('a timed exercise keeps its shape locally', localExercises[0]?.kind === 'timed' && localExercises[0]?.sets === 3 && localExercises[0]?.durationSec === 45, localExercises[0])
  check('it announced once', (await db.updates.toArray()).filter((u) => u.dedupeKey === `workout:${saved.id}`).length === 1)

  const editedLocal = await workoutData.save({
    sessionId: saved.id,
    userId: me.id,
    date: todayKey(),
    kind: 'strength',
    name: 'Routing probe edited',
    durationSec: 1200,
    exercises: [{ name: 'Plank', kind: 'timed', sets: 4, durationSec: 60 }],
  })
  check('an edit stays one workout', editedLocal.id === saved.id && (await db.sessions.count()) === before + 1)
  check('and announces nothing extra', (await db.updates.toArray()).filter((u) => u.dedupeKey === `workout:${saved.id}`).length === 1)

  await workoutData.remove(saved.id)
  check('a delete removes it', (await db.sessions.count()) === before)
  check('and leaves the announcement standing', (await db.updates.toArray()).filter((u) => u.dedupeKey === `workout:${saved.id}`).length === 1)

  head('Cloud mode is only ever switched on deliberately')
  workoutData.useCloud(true)
  check('the store follows the switch', workoutData.current() === 'cloud')
  workoutData.useCloud(false)
  check('and switches back', workoutData.current() === 'local')

  head('The wiring says who may use the cloud')
  const auth = readFileSync('src/context/AuthContext.tsx', 'utf8')
  check('cloud is enabled only for an approved account', auth.includes("workoutData.useCloud(account.status === 'approved')"))
  check('signing out turns it off', /signOut[\s\S]{0,400}workoutData\.useCloud\(false\)/.test(auth))
  check('an unlinked session does not write to the cloud', /setNeedsLink\(true\)/.test(auth) && auth.includes('workoutData.useCloud(false)'))
  check('no backend means local', /if \(!available\)[\s\S]{0,200}workoutData\.useCloud\(false\)/.test(auth))

  head('The cloud service never claims an identity')
  const cloud = readFileSync('src/services/cloudWorkoutService.ts', 'utf8')
  check("it sends the session cookie", cloud.includes("credentials: 'include'"))
  // Scope this to what actually goes out. The file reads `user_id` and
  // `status` off responses, which is not the same as claiming them.
  const payload = cloud.slice(cloud.indexOf('const toPayload'), cloud.indexOf('export const cloudWorkoutService'))
  check('the outgoing payload carries no userId', !/userId|user_id/.test(payload))
  check('and no role or account status', !/role/.test(payload) && !/status/.test(payload))
  check('it carries no secret', !/API_KEY|AUTH_SECRET/.test(cloud))

  head('A cloud workout is still the local profile to edit')
  const routerSrc = readFileSync('src/services/workoutData.ts', 'utf8')
  // The screens ask "is this mine" with the local profile id. A cloud row
  // carries the server account id, so without this relabelling the card
  // quietly drops its edit and delete controls.
  check('cloud rows are relabelled to the local profile', /asLocalOwner\(session, userId\)/.test(routerSrc))
  check('and so is anything saved to the cloud', (routerSrc.match(/asLocalOwner\(\w+\.session, input\.userId\)/g) ?? []).length === 2)
  check('the card reads its exercises through the router', readFileSync('src/components/workout/SessionCard.tsx', 'utf8').includes('workoutData.exercisesFor(session.id)'))

  head('Nothing bulk-uploads local history')
  const router = routerSrc
  // Only code counts; the file's comments explain at length why it does not
  // bulk-upload, and those sentences are not an upload path.
  const code = router
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join(String.fromCharCode(10))
  check('the router has no upload or sync path', !/upload|bulkAdd|migrateAll|syncAll/i.test(code))
  check('and no local history was touched by any of this', (await db.sessions.count()) === before, before)

  console.log(`\n${failures === 0 ? 'Routing is correct.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
