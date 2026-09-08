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

import { existsSync, readFileSync } from 'node:fs'
import { ensureSeeded } from './fixtures/seed'
import { db } from '../src/lib/db'
import { workoutData } from '../src/services/workoutData'
import { cloudSync } from '../src/services/cloudSync'
import { storageService } from '../src/services/storageService'
import { todayKey } from '../src/utils/date'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
const head = (t: string) => console.log(`\n--- ${t} ---\n`)

/**
 * Exactly what a file sends to the server, and nothing around it.
 *
 * A regex cannot do this: these files read and write `userId` on local rows on
 * the lines either side of a push, and a pattern loose enough to reach the end
 * of a multi-line call is loose enough to swallow the announcement that
 * follows it. So the call is read by counting brackets, which is the only way
 * to know where it actually ends. The `*Payload` builders are included too,
 * because a push that hands its row to one is still sending what it returns.
 */
function outgoing(source: string): string {
  const found: string[] = []
  for (const marker of ['cloudSync.push(', 'cloudSync.pushProfile(']) {
    let at = source.indexOf(marker)
    while (at !== -1) {
      let depth = 0
      let end = at + marker.length - 1
      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1
        else if (source[end] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      found.push(source.slice(at, end + 1))
      at = source.indexOf(marker, end)
    }
  }
  for (const match of source.matchAll(/const \w*Payload = \([\s\S]*?\n\}\)/g)) found.push(match[0])
  return found.join(String.fromCharCode(10))
}

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

  /*
   * This used to look for one expression — `useCloud(account.status ===
   * 'approved')` — which tested the shape of a line rather than the property
   * the line was there for. The property is now enforced by control flow: a
   * session that is not approved leaves `resolveSession` before any code that
   * could switch the cloud on. So that is what is checked, in two halves.
   *
   * First: the guard exists, and it detaches and returns rather than falling
   * through. Second: nothing above it turns the cloud on. Together those say
   * the same thing the old assertion meant to, and keep saying it however the
   * approved branch below is rewritten.
   */
  const resolve = auth.slice(auth.indexOf('const resolveSession'), auth.indexOf('useEffect(() => {'))
  check('resolveSession was found', resolve.length > 200, resolve.length)

  const guard = /if \(account\.status !== 'approved'\) \{\s*await detach\(\)\s*return\s*\}/.test(resolve)
  check('an account that is not approved is detached and returns', guard)

  const beforeGuard = resolve.slice(0, resolve.indexOf("account.status !== 'approved'"))
  check('and nothing before that guard turns the cloud on', !/useCloud\(true/.test(beforeGuard))

  // `detach` is the single place that says what "not signed in as an approved
  // account" means, so both switches being in it is the whole of the rule.
  const detach = auth.slice(auth.indexOf('const detach ='), auth.indexOf('const resolveSession'))
  check('detach turns both switches off', /workoutData\.useCloud\(false\)/.test(detach) && /cloudSync\.useCloud\(false\)/.test(detach))

  check('signing out detaches', /const signOut = useCallback\([\s\S]{0,600}await detach\(\)/.test(auth))
  check('an unlinked session does not write to the cloud', /workoutData\.useCloud\(false\)[\s\S]{0,200}setNeedsLink\(true\)/.test(resolve))
  check('no backend means nobody is signed in at all', /if \(!available\) \{[\s\S]{0,300}await detach\(\)\s*return/.test(resolve))

  /*
   * And the fallback is gone rather than disabled. The application used to
   * sign people in against IndexedDB when /api/auth did not answer, which was
   * a second way in that no server had agreed to.
   */
  // Code only. The header comment on AuthProvider explains at length what was
  // removed and why, and naming the thing you deleted is not importing it.
  const authCode = auth
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join(String.fromCharCode(10))
  check('there is no local sign-in left in the app', !/authService/.test(authCode))
  check('and none anywhere in src', !existsSync('src/services/authService.ts'))

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

  head('The rest of the migration routes the same way')
  const sync = readFileSync('src/services/cloudSync.ts', 'utf8')
  const client = readFileSync('src/services/cloudDataService.ts', 'utf8')
  check('a fresh process syncs nothing', cloudSync.enabled() === false, cloudSync.enabled())
  check('and has nothing waiting to send', cloudSync.pending() === 0)
  check('cloud sync is switched by the same guard', !/useCloud\(true/.test(beforeGuard))
  check('signing out turns it off', /workoutData\.useCloud\(false\)\s*\n\s*cloudSync\.useCloud\(false\)/.test(auth))
  check('an unlinked or pending session does not sync', (auth.match(/cloudSync\.useCloud\(false\)/g) ?? []).length >= 2)
  check('the client sends the session cookie', client.includes("credentials: 'include'"))
  check('and treats a non-JSON answer as no backend', /content-type[\s\S]{0,200}unavailable/i.test(client))

  // Comments explain at length what is not uploaded; sentences are not code.
  const syncCode = sync
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join(String.fromCharCode(10))
  check('nothing sweeps local history into the cloud', !/uploadAll|pushAll|migrateAll|syncAll/i.test(syncCode))
  check('hydrate only reads', !/hydrate[\s\S]{0,600}cloudDataService\.post/.test(syncCode))
  check('a failed push never breaks the caller', /async push[\s\S]{0,400}catch/.test(syncCode))

  head('Nothing sent to the server claims an identity')
  const senders = [
    'src/services/nutritionService.ts',
    'src/services/weightService.ts',
    'src/services/stepsService.ts',
    'src/services/checkinService.ts',
    'src/services/postService.ts',
    'src/services/storyService.ts',
    'src/services/updateService.ts',
    'src/services/chatService.ts',
  ]
  for (const file of senders) {
    const source = readFileSync(file, 'utf8')
    // Only the payloads. These files read and write `userId` on local rows all
    // day, which is not the same as telling the server who to be.
    const payloads = outgoing(source)
    const name = file.split('/').pop()
    check(`${name} sends no userId`, !/userId:/.test(payloads), payloads.match(/userId:[^,]*/)?.[0])
    check(`${name} sends no role or status`, !/\brole:|\bstatus:/.test(payloads))
  }

  console.log(`\n${failures === 0 ? 'Routing is correct.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
