/** Structural check: does the configuration this repo writes actually build? */
import { createAuth, AuthNotConfigured, googleConfigured } from '../server/auth/auth'

const fakeD1 = { prepare: () => ({ bind: () => ({ first: async () => null }) }) }
let ok = 0, bad = 0
const t = (label: string, pass: boolean, detail?: unknown) => {
  console.log(`${pass ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ' — ' + String(detail)}`)
  pass ? ok++ : bad++
}

try {
  createAuth({ DB: undefined, AUTH_SECRET: 'x' })
  t('refuses with no database bound', false)
} catch (e) { t('refuses with no database bound', e instanceof AuthNotConfigured) }

try {
  createAuth({ DB: fakeD1, AUTH_SECRET: undefined })
  t('refuses with no AUTH_SECRET', false)
} catch (e) { t('refuses with no AUTH_SECRET', e instanceof AuthNotConfigured) }

try {
  const auth = createAuth({ DB: fakeD1, AUTH_SECRET: 'a'.repeat(32), ENVIRONMENT: 'development', BASE_URL: 'http://localhost:8788' })
  t('builds an instance with a D1 binding', Boolean(auth))
  t('exposes a fetch handler', typeof (auth as { handler?: unknown }).handler === 'function')
  t('exposes the server api', typeof (auth as { api?: unknown }).api === 'object')
  const api = (auth as { api: Record<string, unknown> }).api
  for (const route of ['signUpEmail', 'signInEmail', 'signOut', 'getSession']) {
    t(`api.${route} exists`, typeof api[route] === 'function')
  }
  t('google is off when unconfigured', !googleConfigured({ DB: fakeD1 }))
  t('google is on when both credentials are present', googleConfigured({ DB: fakeD1, GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's' }))
  const withGoogle = createAuth({ DB: fakeD1, AUTH_SECRET: 'a'.repeat(32), GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's', BASE_URL: 'http://localhost:8788' })
  t('builds with the google provider configured', Boolean(withGoogle))
} catch (e) {
  t('builds an instance with a D1 binding', false, e)
}


// --- The route, when the deployment cannot authenticate ------------------
const { onRequest } = await import('../functions/api/auth/[[route]]')

const unconfigured = await onRequest({
  request: new Request('https://circuit.test/api/auth/get-session'),
  env: { DB: undefined } as never,
})
t('the auth route answers 503 when nothing is bound', unconfigured.status === 503)
const body = (await unconfigured.json()) as { error?: string }
t('and says so plainly rather than looking like bad credentials', body.error === 'auth_not_configured')

// --- The browser must actually send the cookie ---------------------------
const { readFileSync } = await import('node:fs')
for (const file of ['src/services/workoutScanService.ts', 'src/services/foodScanService.ts']) {
  t(`${file.split('/').pop()} sends the session cookie`, readFileSync(file, 'utf8').includes("credentials: 'include'"))
}
const client = readFileSync('src/services/serverAuthService.ts', 'utf8')
t('the auth client sends credentials on every call', client.includes("credentials: 'include'"))
// Actual calls, not the word: the file's own comment explains why it does
// not cache identity, and that sentence is not a usage.
t('the auth client stores no identity locally', !/localStorage\s*\./.test(client))

console.log(`\n${bad === 0 ? 'Auth wiring verified against the installed package.' : bad + ' problem(s).'}`)
process.exit(bad === 0 ? 0 : 1)
