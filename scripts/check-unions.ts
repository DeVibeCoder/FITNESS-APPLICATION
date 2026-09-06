/**
 * The server's idea of what a value may be, against the application's.
 *
 * The server validates enums by listing them, and those lists are written out
 * rather than imported: the repositories run in a Worker and the models are
 * the browser's. That is a reasonable split, and it has now twice produced the
 * same bug — a list written from memory, missing a value the application
 * genuinely creates, so a perfectly ordinary save came back a 400.
 *
 * It cost a post type once and a fitness goal once, and both were found by a
 * person using the deployed site rather than by anything that ran here. So the
 * two are compared directly: this reads both files as text and checks that
 * every value the model allows is a value the server accepts.
 *
 * The server may accept MORE than the model — a column that has held a value
 * since before the union narrowed is not a bug. It may never accept less.
 *
 *   npm run db:check:unions
 */
import { readFileSync } from 'node:fs'

const models = readFileSync('src/models/index.ts', 'utf8')

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

/**
 * The members of `export type X = 'a' | 'b'`, on one line or many.
 *
 * The declaration is the `=` line plus every following line that begins with
 * `|`, and nothing after that. Reading further is how a first attempt at this
 * check swallowed the next three types and reported disagreements that were
 * its own.
 */
function modelUnion(name: string): string[] {
  const match = models.match(new RegExp(`export type ${name} =([^\\n]*)\\n((?:\\s*\\|[^\\n]*\\n)*)`))
  if (!match) throw new Error(`No type ${name} in src/models`)
  const declaration = `${match[1]}\n${match[2] ?? ''}`
  return [...declaration.matchAll(/'([^']+)'/g)].map((one) => one[1])
}

/** The members of `const X = ['a', 'b'] as const` in a server file. */
function serverList(file: string, name: string): string[] {
  const source = readFileSync(file, 'utf8')
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`))
  if (!match) throw new Error(`No list ${name} in ${file}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((one) => one[1])
}

/**
 * A union declared inline on an interface field, e.g. `source: 'a' | 'b'`.
 *
 * Scoped to the interface it belongs to, because `source` is a field on three
 * different models and they do not agree — which is the whole reason to check.
 */
function inlineUnion(interfaceName: string, field: string): string[] {
  const block = models.match(new RegExp(`export interface ${interfaceName} \\{[\\s\\S]*?\\n\\}`))
  if (!block) throw new Error(`No interface ${interfaceName} in src/models`)
  const match = block[0].match(new RegExp(`\\n\\s*${field}: ('[^\\n]+)`))
  if (!match) throw new Error(`No inline union for ${interfaceName}.${field}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((one) => one[1])
}

const pairs: { label: string; model: string[]; server: string[] }[] = [
  { label: 'post types', model: modelUnion('PostType'), server: serverList('server/data/socialRepo.ts', 'POST_TYPES') },
  { label: 'story types', model: modelUnion('StoryType'), server: serverList('server/data/socialRepo.ts', 'STORY_TYPES') },
  { label: 'visibility', model: modelUnion('Visibility'), server: serverList('server/data/socialRepo.ts', 'VISIBILITIES') },
  { label: 'shared types', model: modelUnion('SharedType'), server: serverList('server/data/socialRepo.ts', 'SHARED_TYPES') },
  { label: 'update kinds', model: modelUnion('UpdateKind'), server: serverList('server/data/socialRepo.ts', 'UPDATE_KINDS') },
  { label: 'shared types (chat)', model: modelUnion('SharedType'), server: serverList('server/data/chatRepo.ts', 'SHARED_TYPES') },
  { label: 'meal slots', model: modelUnion('MealSlot'), server: serverList('server/data/nutritionRepo.ts', 'MEALS') },
  { label: 'soreness', model: modelUnion('Soreness'), server: serverList('server/data/nutritionRepo.ts', 'SORENESS') },
  { label: 'step sources', model: inlineUnion('StepEntry', 'source'), server: serverList('server/data/nutritionRepo.ts', 'STEP_SOURCES') },
  { label: 'food sources', model: inlineUnion('FoodEntry', 'source'), server: serverList('server/data/nutritionRepo.ts', 'FOOD_SOURCES') },
  { label: 'fitness goals', model: modelUnion('FitnessGoal'), server: serverList('server/data/profileRepo.ts', 'GOALS') },
  { label: 'activity levels', model: modelUnion('ActivityLevel'), server: serverList('server/data/profileRepo.ts', 'ACTIVITY') },
  { label: 'units', model: modelUnion('Units'), server: serverList('server/data/profileRepo.ts', 'UNITS') },
  { label: 'sex', model: modelUnion('Sex'), server: serverList('server/data/profileRepo.ts', 'SEXES') },
  { label: 'challenge metrics', model: modelUnion('ChallengeMetric'), server: serverList('server/data/trainingRepo.ts', 'METRICS') },
]

console.log('\n--- Every value the app can create, the server accepts ---\n')
for (const pair of pairs) {
  const missing = pair.model.filter((value) => !pair.server.includes(value))
  check(`${pair.label} — ${pair.model.length} value(s)`, missing.length === 0, missing.length ? { missing } : undefined)
}

console.log(`\n${failures === 0 ? 'The server and the application agree.' : `${failures} disagreement(s).`}`)
process.exit(failures === 0 ? 0 : 1)
