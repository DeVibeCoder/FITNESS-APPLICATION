/**
 * What is actually in the thing people download.
 *
 * Every other check in this project reads source. This one reads `dist`,
 * because the question it answers is not "did we write the right code" but
 * "did the right bytes come out" — and those are different questions. A demo
 * password removed from a screen and left in a module the screen no longer
 * imports is still a demo password on the internet, and no source-level check
 * would have said so.
 *
 * The list below is deliberately literal. It is the fixture group's names, its
 * shared password, the module paths that used to carry them, the development
 * database's id, and the shapes a secret takes. Anything found is printed with
 * the file it was found in, because "something matched" is not actionable.
 *
 * Run after a build:
 *
 *   npm run build && npm run check:bundle
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (label: string, ok: unknown, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

const DIST = 'dist'

/** Every text file the browser could be served, JS and CSS and HTML alike. */
function bundleFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...bundleFiles(path))
      continue
    }
    if (/\.(js|mjs|css|html|json|map|webmanifest)$/i.test(entry)) found.push(path)
  }
  return found
}

/**
 * Strings that must not be in a published bundle, and why each one is here.
 *
 * `word: true` matches on a word boundary. Without it "ahmed" hits nothing and
 * "samir" hits nothing, but a three-letter fixture name would hit half the
 * minified identifiers in React — a check that cries wolf is a check somebody
 * turns off.
 */
const FORBIDDEN: { needle: string; word?: boolean; why: string }[] = [
  { needle: 'circuit2026', why: 'the fixture group’s shared password' },
  { needle: 'DEMO_PASSWORD', why: 'the constant that held it' },
  { needle: 'DEMO_HANDLES', why: 'the fixture account list' },
  { needle: 'demoDataEnabled', why: 'the build flag that switched the demo on' },
  { needle: 'VITE_DEMO_DATA', why: 'the environment variable behind that flag' },
  { needle: 'ahmed', word: true, why: 'a fixture account' },
  { needle: 'nadia', word: true, why: 'a fixture account' },
  { needle: 'samir', word: true, why: 'a fixture account' },
  { needle: 'seedDatabase', why: 'the fixture seeder' },
  { needle: 'ensureSeeded', why: 'the fixture seeder’s entry point' },
  { needle: 'resetDatabase', why: 'the reset-to-demo control' },
  { needle: 'Reset to demo data', why: 'the reset-to-demo control’s label' },
  // The development D1. A production bundle has no business naming it, and a
  // copied command line that does is how one environment writes to another.
  { needle: '722c4aba-d51f-4040-af0e-752916df3f0d', why: 'the development database id' },
  { needle: 'AUTH_SECRET', why: 'a server-side secret’s name' },
  { needle: 'GEMINI_API_KEY', why: 'a server-side secret’s name' },
  { needle: 'FDC_API_KEY', why: 'a server-side secret’s name' },
  { needle: 'GOOGLE_CLIENT_SECRET', why: 'a server-side secret’s name' },
]

console.log('\n--- What is in dist ---\n')

const files = bundleFiles(DIST)
check('the bundle was built', files.length > 0, { files: files.length })

const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]))

for (const { needle, word, why } of FORBIDDEN) {
  const pattern = word
    ? new RegExp(`\\b${needle}\\b`, 'i')
    : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const hits = [...contents]
    .filter(([, text]) => pattern.test(text))
    .map(([file]) => file)
  check(`no "${needle}" anywhere — ${why}`, hits.length === 0, hits.length ? hits : undefined)
}

/*
 * The fixture user ids are the one thing allowed in, and only in one place.
 *
 * `purgeLegacyDemo` names them because its job is deleting them: devices
 * seeded by an older build still hold those rows, and removing the fixture
 * from the bundle did nothing about the phones that already had it. So the
 * rule is not "these strings must not appear" — it is "these strings may
 * appear only in the module that exists to remove them", which is identified
 * by the marker only that module writes.
 *
 * The distinction that matters is data versus a delete list. An id is a
 * handful of characters naming a row; the fixture itself — the names, the
 * password, the invented history — is checked for above and must still be
 * absent everywhere.
 */
const FIXTURE_IDS = ['u_ahmed', 'u_nadia', 'u_samir', 'u_leila']
const purgeFiles = [...contents].filter(([, text]) => text.includes('demoPurgedAt')).map(([file]) => file)
check('the legacy purge is in the bundle', purgeFiles.length > 0, purgeFiles)

for (const id of FIXTURE_IDS) {
  const elsewhere = [...contents]
    .filter(([file, text]) => text.includes(id) && !purgeFiles.includes(file))
    .map(([file]) => file)
  check(`"${id}" appears only in the purge module`, elsewhere.length === 0, elsewhere.length ? elsewhere : undefined)
}

/*
 * The fixture directory must not have been reachable at all. A chunk named
 * after it would mean Rollup found an import path into it, which is the exact
 * failure this whole arrangement exists to make impossible.
 */
const fixtureChunk = files.filter((file) => /fixtur|seed/i.test(file))
check('no fixture chunk was emitted', fixtureChunk.length === 0, fixtureChunk.length ? fixtureChunk : undefined)

/*
 * And the positive half. A check that only looks for absences passes happily
 * against an empty directory, so this confirms the application is in there.
 */
const anyText = [...contents.values()].join('\n')
check('the application itself is present', anyText.includes('RALLY'))
check('the real sign-in path is present', anyText.includes('/api/auth'))

console.log(`\n${failures === 0 ? 'The bundle carries nothing it should not.' : `${failures} problem(s).`}`)
process.exit(failures === 0 ? 0 : 1)
