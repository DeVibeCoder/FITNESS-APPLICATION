/**
 * The identity bridge, against a real seeded database.
 *
 * The question this has to answer is not "does the mapping store a string"
 * but "after signing in with a cloud account, is the history still there and
 * still untouched". So it seeds the database the way a real device would
 * have it, counts every owned row before and after, and compares.
 *
 *   npm run db:check:link
 */
import 'fake-indexeddb/auto'
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
} as Storage

import { ensureSeeded } from '../src/data/seed'
import { db } from '../src/lib/db'
import { identityLinkService, LinkRefused } from '../src/services/identityLinkService'
import { storageService } from '../src/services/storageService'
import { workoutService } from '../src/services/workoutService'
import { nutritionService } from '../src/services/nutritionService'
import { todayKey } from '../src/utils/date'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
const head = (t: string) => console.log(`\n--- ${t} ---\n`)

/** Every row on the device that belongs to somebody, by owner. */
async function census(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const tally = async (name: string, rows: { userId?: string }[]) => {
    counts[name] = rows.length
  }
  await tally('sessions', await db.sessions.toArray())
  await tally('loggedExercises', await db.loggedExercises.toArray())
  await tally('foods', await db.foods.toArray())
  await tally('water', await db.water.toArray())
  await tally('steps', await db.steps.toArray())
  await tally('weights', await db.weights.toArray())
  await tally('checkins', await db.checkins.toArray())
  await tally('posts', await db.posts.toArray())
  await tally('messages', await db.messages.toArray())
  await tally('updates', await db.updates.toArray())
  await tally('users', await db.users.toArray())
  return counts
}

async function main() {
  await ensureSeeded()

  const localUsers = await db.users.toArray()
  const ahmed = localUsers[0]
  const nadia = localUsers[1]

  // A fingerprint of the history before anything is linked.
  const before = await census()
  const ahmedSessionIds = (await db.sessions.where('userId').equals(ahmed.id).toArray()).map((s) => s.id).sort()
  const ahmedFoodIds = (await db.foods.where('userId').equals(ahmed.id).toArray()).map((f) => f.id).sort()
  console.log('device history before linking:', JSON.stringify(before))

  const cloud = { id: 'srv_' + Math.random().toString(36).slice(2, 10), email: ahmed.email, name: ahmed.name }
  const other = { id: 'srv_other_' + Math.random().toString(36).slice(2, 8), email: 'someone.else@circuit.test', name: 'Other' }

  // --- 4. An unmatched/first sign-in must ask ------------------------------
  head('First sign-in offers a choice rather than taking one')
  const first = await identityLinkService.resolve(cloud)
  check('a new account is not silently linked', first.kind === 'choice', first.kind)
  if (first.kind === 'choice') {
    check('3. an email match is offered as a hint', first.emailMatch?.id === ahmed.id, first.emailMatch?.id)
    check('the other local profiles are offered too', first.localUsers.length === localUsers.length)
  }
  check('nothing was linked by merely asking', (await identityLinkService.linkedLocalUserId(cloud.id)) === null)

  // --- 1. Explicit link, then resolution -----------------------------------
  head('1. serverUserId resolves to localUserId once linked')
  await identityLinkService.link(cloud.id, ahmed.id)
  const resolved = await identityLinkService.resolve(cloud)
  check('resolution now returns the link', resolved.kind === 'linked')
  check('and points at the right local user', resolved.kind === 'linked' && resolved.localUserId === ahmed.id)

  // --- The critical one: the history is still there and still theirs -------
  head('Existing Dexie data is visible to the linked account')
  storageService.setSessionUserId(ahmed.id)
  const sessions = await workoutService.sessionsForUser(ahmed.id)
  const stats = await workoutService.stats(ahmed.id, [todayKey()])
  const foods = await nutritionService.foodForDay(ahmed.id, todayKey())
  check('workout history reads back', sessions.length > 0, sessions.length)
  check('workout stats compute over it', stats.total === sessions.length, [stats.total, sessions.length])
  check('nutrition reads back', Array.isArray(foods))

  const after = await census()
  check('6. not one row was added or removed anywhere', JSON.stringify(after) === JSON.stringify(before), { before, after })
  const sessionIdsAfter = (await db.sessions.where('userId').equals(ahmed.id).toArray()).map((s) => s.id).sort()
  const foodIdsAfter = (await db.foods.where('userId').equals(ahmed.id).toArray()).map((f) => f.id).sort()
  check('6. the same session rows, with the same ids', JSON.stringify(sessionIdsAfter) === JSON.stringify(ahmedSessionIds))
  check('6. the same food rows, with the same ids', JSON.stringify(foodIdsAfter) === JSON.stringify(ahmedFoodIds))
  check('6. historical rows still carry the original local owner', sessionIdsAfter.length > 0 && (await db.sessions.get(sessionIdsAfter[0]))?.userId === ahmed.id)

  // --- A write still lands on the same owner -------------------------------
  head('8. A write goes to the same local owner')
  const written = await workoutService.logManual({
    userId: ahmed.id,
    date: todayKey(),
    kind: 'strength',
    name: 'Phase 8 link probe',
    durationSec: 600,
    exercises: [],
  })
  check('the new session belongs to the linked local user', written.userId === ahmed.id)
  check('and is visible through the ordinary read path', (await workoutService.sessionsForUser(ahmed.id)).some((s) => s.id === written.id))
  await workoutService.removeSession(written.id)

  // --- 2. The link survives a "reload" -------------------------------------
  head('2. The link survives a reload')
  storageService.setSessionUserId(null)
  store.clear() // a reload with nothing in localStorage at all
  const afterReload = await identityLinkService.resolve(cloud)
  check('the same account still resolves to the same local user', afterReload.kind === 'linked' && afterReload.localUserId === ahmed.id)
  check('8. localStorage was empty and made no difference', store.size === 0)

  // --- 7/8. Another account cannot take it ---------------------------------
  head('7. A different account cannot claim linked data')
  let refusedOther = ''
  try {
    await identityLinkService.link(other.id, ahmed.id)
  } catch (error) {
    refusedOther = error instanceof LinkRefused ? 'refused' : 'threw'
  }
  check('7. linking another account to the same local user is refused', refusedOther === 'refused')
  const otherResolution = await identityLinkService.resolve(other)
  check('7. and it is not even offered as a choice', otherResolution.kind === 'choice' && !otherResolution.localUsers.some((u) => u.id === ahmed.id))
  check('7. two accounts do not resolve to one local identity', (await identityLinkService.linkedLocalUserId(other.id)) === null)

  let refusedRelink = ''
  try {
    await identityLinkService.link(cloud.id, nadia.id)
  } catch (error) {
    refusedRelink = error instanceof LinkRefused ? 'refused' : 'threw'
  }
  check('an already-linked account cannot be pointed somewhere else', refusedRelink === 'refused')
  check('the original link is intact', (await identityLinkService.linkedLocalUserId(cloud.id)) === ahmed.id)

  // --- 8. localStorage cannot override the mapping -------------------------
  head('8. localStorage cannot override the mapping')
  storageService.setSessionUserId(nadia.id)
  const stillAhmed = await identityLinkService.resolve(cloud)
  check('a forged local session id changes nothing', stillAhmed.kind === 'linked' && stillAhmed.localUserId === ahmed.id)
  storageService.setSessionUserId(null)

  // --- 5. Starting fresh leaves the old data alone -------------------------
  head('5. Starting fresh leaves existing data untouched')
  const freshBefore = await census()
  const freshLocalId = await identityLinkService.startFresh(other)
  check('a new local profile was created', Boolean(await db.users.get(freshLocalId)))
  check('5. it is a different identity from the existing ones', !localUsers.some((u) => u.id === freshLocalId))
  const freshAfter = await census()
  check('5. exactly one row was added, and it was the user', freshAfter.users === freshBefore.users + 1)
  for (const table of Object.keys(freshBefore)) {
    if (table === 'users') continue
    check(`5. ${table} is unchanged by starting fresh`, freshAfter[table] === freshBefore[table], [freshBefore[table], freshAfter[table]])
  }
  check('5. the fresh account owns no history', (await workoutService.sessionsForUser(freshLocalId)).length === 0)
  check("5. and the original account's history is still intact", (await workoutService.sessionsForUser(ahmed.id)).length === sessions.length)

  console.log(`\n${failures === 0 ? 'The identity bridge holds, and nothing was rewritten.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
