/**
 * Opens a database at the old schema, puts real rows in it, then opens it
 * again with the current schema and checks nothing was lost. This is the
 * question "does v6 break an existing device" asked directly.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'

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

let failures = 0
function ok(label: string, condition: boolean, detail = '') {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  // --- the database as it stood before this phase -------------------------
  const old = new Dexie('circuit')
  old.version(1).stores({
    users: 'id, handle',
    goals: 'id, userId',
    weights: 'id, userId, date, [userId+date]',
    measurements: 'id, userId, date, [userId+date]',
    photos: 'id, userId, [userId+date]',
    exercises: 'id, name',
    plans: 'id, ownerId',
    enrollments: 'id, userId, planId',
    planDays: 'id, planId, [planId+dayNumber]',
    workoutExercises: 'id, planDayId, [planDayId+order]',
    sessions: 'id, userId, date, status, [userId+date], [userId+status]',
    setResults: 'id, sessionId, [sessionId+workoutExerciseId]',
    foods: 'id, userId, date, [userId+date]',
    water: 'id, userId, date, [userId+date]',
    steps: 'id, userId, date, [userId+date]',
    checkins: 'id, userId, date, [userId+date]',
    updates: 'id, userId, createdAt',
    reactions: 'id, updateId, [updateId+userId]',
    achievements: 'id, userId, [userId+achievementKey]',
    videos: 'id, addedBy',
    meta: 'key',
  })
  old.version(2).stores({ challenges: 'id, &weekStart' })
  old.version(3).stores({
    messages: 'id, userId, createdAt, replyToId',
    chatReactions: 'id, messageId, [messageId+userId]',
  })
  old.version(4).stores({
    posts: 'id, userId, createdAt, type',
    postReactions: 'id, postId, [postId+userId]',
    comments: 'id, postId, createdAt',
    stories: 'id, userId, createdAt, expiresAt',
    storyViews: 'id, storyId, [storyId+userId]',
    media: 'id',
    notifications: 'id, userId, createdAt, readAt',
  })
  old.version(5)

  await old.open()
  console.log(`\n— A device holding v${old.verno} data —\n`)
  await old.table('users').add({ id: 'u_old', name: 'Old Timer', handle: 'old', avatarColor: '#f00' })
  await old.table('sessions').add({ id: 's_old', userId: 'u_old', date: '2026-08-01', status: 'completed' })
  await old.table('weights').add({ id: 'w_old', userId: 'u_old', date: '2026-08-01', weightKg: 80, kind: 'official' })
  await old.table('messages').add({ id: 'm_old', userId: 'u_old', text: 'still here', createdAt: '2026-08-01T09:00:00.000Z' })
  await old.table('posts').add({ id: 'p_old', userId: 'u_old', type: 'text', text: 'hello', createdAt: '2026-08-01T09:00:00.000Z' })
  await old.table('challenges').add({ id: 'gc_old', weekStart: '2026-07-26', title: 'Old challenge' })
  await old.table('achievements').add({ id: 'ua_old', userId: 'u_old', achievementKey: 'first_workout', unlockedAt: '2026-08-01T09:00:00.000Z' })
  ok('rows written at the old version', (await old.table('users').count()) === 1)
  old.close()

  // --- now open it with the schema this phase ships ------------------------
  const { db } = await import('../src/lib/db')
  await db.open()
  console.log(`\n— Reopened at v${db.verno} —\n`)
  ok('the upgrade ran', db.verno >= 6, `version ${db.verno}`)
  ok('the user survived', (await db.users.get('u_old'))?.name === 'Old Timer')
  ok('the workout survived', (await db.sessions.get('s_old'))?.status === 'completed')
  ok('the weigh-in survived', (await db.weights.get('w_old'))?.weightKg === 80)
  ok('the message survived', (await db.messages.get('m_old'))?.text === 'still here')
  ok('the post survived', (await db.posts.get('p_old'))?.text === 'hello')
  ok('the challenge survived', (await db.challenges.get('gc_old'))?.title === 'Old challenge')
  ok('the achievement survived', (await db.achievements.get('ua_old'))?.achievementKey === 'first_workout')
  ok('the new store exists and is empty', (await db.challengeParticipants.count()) === 0)
  await db.challengeParticipants.add({
    id: 'cp_1',
    challengeId: 'gc_old',
    userId: 'u_old',
    joinedAt: '2026-08-01T09:00:00.000Z',
    leftAt: '2026-08-01T09:00:00.000Z',
  })
  ok('and it takes rows', (await db.challengeParticipants.count()) === 1)
  const found = await db.challengeParticipants.where('[challengeId+userId]').equals(['gc_old', 'u_old']).first()
  ok('with the compound index join and leave use', found?.id === 'cp_1')

  console.log(`\n${failures === 0 ? 'Upgrade is safe.' : `${failures} check(s) failed.`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
