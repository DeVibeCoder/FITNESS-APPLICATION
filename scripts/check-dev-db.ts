/**
 * Checks the development database is shaped the way the migrations say, and
 * that it contains reference data and nothing that names a person.
 *
 * Read-only. It shells out to wrangler rather than opening a connection,
 * because the credentials for that already live in the CLI and there is no
 * reason for a second copy of them here.
 *
 *   npm run db:check:dev
 */
import { execSync } from 'node:child_process'
import { currentEnvironment, seedableReason } from './guard-environment'

const DB = 'circuit-dev'

function query<T>(sql: string): T[] {
  // Through a shell so this works the same on Windows and POSIX.
  const out = execSync(
    `npx wrangler d1 execute ${DB} --env preview --remote --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[]
  return parsed.flatMap((block) => block.results ?? [])
}

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

/** Every table the migrations create, so a missing one is loud. */
const EXPECTED = [
  'users', 'auth_accounts', 'auth_sessions', 'auth_verification_tokens',
  'groups', 'group_members',
  'exercises', 'plans', 'plan_days', 'plan_exercises', 'plan_enrollments',
  'workout_sessions', 'logged_exercises', 'set_results',
  'weights', 'measurements', 'progress_photos',
  'food_entries', 'water_entries', 'step_entries', 'checkins', 'user_goals',
  'group_updates', 'update_reactions', 'media_assets',
  'posts', 'post_media', 'post_reactions', 'comments',
  'stories', 'story_views', 'motivation_videos',
  'conversations', 'conversation_participants', 'messages', 'message_reactions',
  'achievement_definitions', 'user_achievements',
  'challenges', 'challenge_participants', 'notifications',
]

/** Tables that must be empty in any environment that has not been used yet. */
const PERSON_TABLES = [
  'users', 'auth_accounts', 'auth_sessions', 'workout_sessions', 'logged_exercises',
  'set_results', 'weights', 'measurements', 'food_entries', 'water_entries',
  'step_entries', 'checkins', 'group_updates', 'posts', 'stories', 'messages',
  'notifications', 'user_achievements',
]

console.log(`Environment: ${currentEnvironment()}`)
const seed = seedableReason()
console.log(`Fixture seeding: ${seed.seedable ? 'ALLOWED' : 'refused'}`)
if (!seed.seedable) console.log(seed.reason.split('\n').map((l) => `   ${l}`).join('\n'))
console.log('')

const tables = query<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations';",
).map((r) => r.name)

const missing = EXPECTED.filter((t) => !tables.includes(t))
check(`all ${EXPECTED.length} tables exist`, missing.length === 0, missing.length ? { missing } : undefined)

const counts = query<Record<string, number>>(
  `SELECT ${PERSON_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')};`,
)[0]
const populated = Object.entries(counts).filter(([, n]) => n > 0)
check('no table holds data about a person', populated.length === 0, populated.length ? populated : undefined)

const reference = query<{ exercises: number; achievements: number }>(
  'SELECT (SELECT COUNT(*) FROM exercises) AS exercises, (SELECT COUNT(*) FROM achievement_definitions) AS achievements;',
)[0]
check('exercise catalogue present', reference.exercises > 0, reference.exercises)
check('achievement definitions present', reference.achievements > 0, reference.achievements)

const dedupe = query<{ sql: string }>(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='group_updates';",
)[0]?.sql ?? ''
check('group_updates.dedupe_key is UNIQUE', /dedupe_key\s+TEXT\s+UNIQUE/i.test(dedupe))
check(
  'group_updates has no foreign key to a workout',
  !/REFERENCES\s+workout_sessions/i.test(dedupe),
)

const logged = query<{ sql: string }>(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='logged_exercises';",
)[0]?.sql ?? ''
// Three table-level guards, one per kind. The column's own CHECK (kind IN ...)
// is a different rule and is not what this counts.
check(
  'logged_exercises constrains fields per kind',
  (logged.match(/CHECK\s*\(\s*kind\s*<>/gi) ?? []).length === 3,
  (logged.match(/CHECK\s*\(\s*kind\s*<>/gi) ?? []).length,
)

console.log(`\n${failures === 0 ? 'Development database is correct.' : `${failures} problem(s).`}`)
process.exit(failures === 0 ? 0 : 1)
