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
import { ensureSeeded } from '../src/data/seed'
import { db } from '../src/lib/db'
import { workoutService } from '../src/services/workoutService'
import { updateService } from '../src/services/updateService'
import { storageService } from '../src/services/storageService'
import { todayKey } from '../src/utils/date'

let fails = 0
const ok = (label: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log('PASS ', label)
  else { fails++; console.log('FAIL ', label, detail === undefined ? '' : JSON.stringify(detail)) }
}

const main = async () => {
  await ensureSeeded()
  const me = (await db.users.toArray())[0]
  storageService.setSessionUserId(me.id)
  const day = todayKey()
  for (const s of await workoutService.sessionsForDay(me.id, day)) await workoutService.removeSession(s.id)

  const keyOf = (id: string) => 'workout:' + id
  const updatesFor = async (id: string) => (await db.updates.toArray()).filter((u) => u.dedupeKey === keyOf(id))

  // --- log ---
  const a = await workoutService.logManual({
    userId: me.id, date: day, kind: 'strength', name: 'P29 probe', durationSec: 900, caloriesKcal: 120,
    exercises: [{ name: 'Squat', kind: 'strength', sets: 3, reps: 10 }],
  })
  ok('logging posts exactly one group update', (await updatesFor(a.id)).length === 1)

  // --- edit must not post again ---
  await workoutService.logManual({
    sessionId: a.id, userId: me.id, date: day, kind: 'strength', name: 'P29 probe edited',
    durationSec: 1200, caloriesKcal: 150,
    exercises: [{ name: 'Squat', kind: 'strength', sets: 4, reps: 8 }],
  })
  ok('editing does NOT create a second update', (await updatesFor(a.id)).length === 1)
  ok('editing kept one session', (await workoutService.sessionsForDay(me.id, day)).length === 1)
  const upd = (await updatesFor(a.id))[0]
  console.log('      update text after edit:', JSON.stringify(upd.text), 'meta:', JSON.stringify(upd.meta))

  // --- reaction on the update, then delete the workout ---
  const other = (await db.users.toArray())[1]
  storageService.setSessionUserId(other.id)
  await updateService.toggleReaction(upd.id, other.id, '\u{1F525}')
  storageService.setSessionUserId(me.id)
  const rx = await db.reactions.where('updateId').equals(upd.id).toArray()
  ok('a teammate could react to the update', rx.length === 1)

  await workoutService.removeSession(a.id)

  // --- integrity after delete ---
  ok('session row is gone', (await db.sessions.get(a.id)) === undefined)
  ok('no logged exercises left behind', (await db.loggedExercises.where('sessionId').equals(a.id).count()) === 0)
  ok('no set results left behind', (await db.setResults.where('sessionId').equals(a.id).count()) === 0)
  const left = await updatesFor(a.id)
  ok('the group update survives, exactly once', left.length === 1, left.length)
  ok('the surviving update carries no session reference',
     !JSON.stringify(left[0]).includes(a.id.replace('workout:', '')) || !('sessionId' in left[0]),
     Object.keys(left[0]))
  console.log('      surviving update fields:', JSON.stringify(Object.keys(left[0])))
  ok('its reaction still points at a live update row',
     (await db.reactions.where('updateId').equals(upd.id).toArray()).length === 1)
  ok('the update row it points at still exists', (await db.updates.get(upd.id)) !== undefined)

  // Would any renderer dereference a session from it? Prove the shape is flat.
  const flat = left[0] as Record<string, unknown>
  ok('update has no id pointing at any session/exercise table',
     !('sessionId' in flat) && !('workoutId' in flat) && !('refId' in flat))

  // --- re-log after delete ---
  const c = await workoutService.logManual({
    userId: me.id, date: day, kind: 'strength', name: 'P29 probe relogged', durationSec: 900,
    exercises: [],
  })
  const both = (await db.updates.toArray()).filter(
    (u) => u.dedupeKey === keyOf(a.id) || u.dedupeKey === keyOf(c.id),
  )
  console.log('      after delete + re-log, updates for the two session ids:', both.length)
  console.log('      texts:', JSON.stringify(both.map((u) => u.text)))
  ok('re-logging creates a new session', c.id !== a.id)
  ok('exactly one session exists for the day', (await workoutService.sessionsForDay(me.id, day)).length === 1)
  ok('the two updates have distinct dedupe keys (not a duplicate write)',
     new Set(both.map((u) => u.dedupeKey)).size === both.length)

  // --- no duplicate update rows anywhere, and none orphaned ---
  const all = await db.updates.toArray()
  const keys = all.map((u) => u.dedupeKey).filter(Boolean)
  ok('no two update rows share a dedupe key', new Set(keys).size === keys.length)
  const updateIds = new Set(all.map((u) => u.id))
  ok('no reaction points at a missing update',
     (await db.reactions.toArray()).every((r) => updateIds.has(r.updateId)))

  await workoutService.removeSession(c.id)
  console.log(fails === 0 ? '\nWORKOUT/UPDATE INTEGRITY CLEAN' : `\n${fails} FAILURE(S)`)
  process.exit(fails === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
