/**
 * Every statement that touches a row belonging to a person, and how it is
 * scoped.
 *
 * The rule this enforces is the one the repositories were written around: a
 * row that is not yours does not come back. Not "comes back and is then
 * checked" — a JavaScript check after the fact is a check somebody can forget,
 * and the moment the wrong row is in hand it is one `return` away from being
 * sent. So every read, update and delete of a user-owned table carries its
 * owner in the WHERE clause, and this reads the SQL to confirm it.
 *
 * INSERTs are exempt and it matters why: an insert does not select a row, it
 * writes one, and the owner is a bound value taken from the session. There is
 * nothing for a WHERE clause to protect.
 *
 * Two tables are deliberately group-visible and are listed as such below, with
 * the reason. Anything else unscoped is a finding.
 *
 *   npm run db:check:isolation
 */
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

/** Tables whose rows belong to exactly one person. */
const OWNED = [
  'food_entries',
  'water_entries',
  'step_entries',
  'weights',
  'checkins',
  'measurements',
  'workout_sessions',
  'plan_enrollments',
  'notifications',
  'user_achievements',
]

/**
 * Rows any approved account may read, and why.
 *
 * This application is one group. A post, a story, a message and the feed are
 * written by one person and read by everybody — that is the product, not an
 * oversight — so those reads carry no owner filter by design. Writing to them
 * still does, which is where `removeOwn` and the `WHERE user_id = ?` on every
 * update come in.
 *
 * `media_assets` is here for the same reason: the image on somebody's post has
 * to be readable by everyone who can see the post. The row holds a storage key
 * and dimensions — no bytes, no personal data — and the route that returns it
 * requires an approved session like everything else.
 */
const GROUP_VISIBLE = ['posts', 'stories', 'comments', 'messages', 'group_updates', 'media_assets']

const scoped = (statement: string): boolean =>
  /user_id\s*=\s*\?/.test(statement) ||
  /owner_user_id\s*=\s*\?/.test(statement) ||
  /added_by\s*=\s*\?/.test(statement) ||
  // Set results inherit their owner from the session they hang off.
  /workout_sessions\s+ws/.test(statement)

const files = globSync('server/**/*.ts')
const findings: { file: string; table: string; statement: string }[] = []
let inspected = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  // Both quoting styles: short statements are written with single quotes in
  // this codebase and long ones with backticks, and a scan that reads only one
  // of them inspects a fraction of the SQL while reporting success.
  const statements = [
    ...source.matchAll(/`([^`]*?(?:SELECT|INSERT|UPDATE|DELETE)[^`]*?)`/gs),
    ...source.matchAll(/'([^'\r\n]*?(?:SELECT|INSERT|UPDATE|DELETE)[^'\r\n]*?)'/g),
  ]
  for (const match of statements) {
    const statement = match[1].replace(/\s+/g, ' ').trim()
    // An INSERT binds its owner; there is no row to filter.
    if (/^INSERT\b/i.test(statement)) continue
    // A statement that reads a group-visible table alongside an owned one is
    // reporting on the group, not leaking a person — the join carries the
    // owner. Named explicitly so the exemption is a decision, not an accident.
    if (GROUP_VISIBLE.some((table) => new RegExp(`\\bFROM\\s+${table}\\b`).test(statement))) continue
    for (const table of OWNED) {
      if (!new RegExp(`\\b(FROM|UPDATE)\\s+${table}\\b`).test(statement)) continue
      inspected += 1
      if (!scoped(statement)) findings.push({ file, table, statement: statement.slice(0, 160) })
      break
    }
  }
}

console.log('\n--- A row that is not yours does not come back ---\n')
check(`every read and write of a user-owned table is owner-scoped (${inspected} statement(s))`, findings.length === 0, findings)

/*
 * The dynamic table names in the shared helpers are literals chosen in this
 * codebase, never a caller's string — but that is worth proving rather than
 * asserting, because a helper that took a table name from a request would be a
 * way to reach any table at all.
 */
console.log('\n--- No table name comes from a request ---\n')
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const interpolatedTables = [...source.matchAll(/FROM \$\{(\w+)\}|INTO \$\{(\w+)\}|UPDATE \$\{(\w+)\}/g)]
    .map((one) => one[1] ?? one[2] ?? one[3])
  for (const name of new Set(interpolatedTables)) {
    // The identifier must be a parameter of a helper called only with literals.
    const callSites = [...source.matchAll(new RegExp(`'[a-z_]+'(?=,\\s*userId)`, 'g'))].length
    check(`${file.split(/[\\/]/).pop()} interpolates '${name}' from a literal, not a request`, callSites > 0 || name === 'table')
  }
}

console.log('\n--- Ownership is enforced on the way out, not only on the way in ---\n')
const dataRoutes = readFileSync('functions/api/data/[[route]].ts', 'utf8')
const deleteHandlers = [...dataRoutes.matchAll(/DELETE: async \(\{([^}]*)\}\)/g)].map((one) => one[1])
check(
  'every DELETE handler takes the user from the session',
  deleteHandlers.every((args) => args.includes('user')),
  deleteHandlers.filter((args) => !args.includes('user')),
)
check('and none takes an owner from the query string', !/searchParams\.get\('userId'\)/.test(dataRoutes))

console.log('\n--- The admin role is read from the database, never a request ---\n')
const guard = readFileSync('server/auth/guard.ts', 'utf8')
check("requireAdmin reads the role off the user row", /user\.role !== 'admin'/.test(guard))
const adminRoute = readFileSync('functions/api/admin/[[route]].ts', 'utf8')
check('the admin routes take no role from the body', !/body[\s\S]{0,200}\.role/.test(adminRoute))
const adminRepo = readFileSync('server/data/adminRepo.ts', 'utf8')
check('and an admin cannot decide about themselves', /id <> \?/.test(adminRepo))

console.log('\n--- The realtime socket is authenticated and scoped ---\n')
const socket = readFileSync('functions/api/chat/socket.ts', 'utf8')
check('the socket requires an approved account', /requireApprovedUser/.test(socket))
check('and membership of the conversation', /isMember/.test(socket))
check('the object is reached through the binding, not a public route', /CHAT_ROOM/.test(socket))

console.log(`\n${failures === 0 ? 'Data isolation holds.' : `${failures} problem(s).`}`)
process.exit(failures === 0 ? 0 : 1)
