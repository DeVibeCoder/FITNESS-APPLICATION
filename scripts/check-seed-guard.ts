/**
 * Proves the seed guard refuses every combination except the deliberate one.
 *
 * Run with: npm run db:check:guard
 */
import { assertSeedable, currentEnvironment } from './guard-environment'

const cases: { label: string; env: Record<string, string | undefined>; allowed: boolean }[] = [
  { label: 'nothing set (unknown environment)', env: {}, allowed: false },
  { label: 'ENVIRONMENT=production, ALLOW_SEED=1', env: { ENVIRONMENT: 'production', ALLOW_SEED: '1' }, allowed: false },
  { label: 'ENVIRONMENT=development, no ALLOW_SEED', env: { ENVIRONMENT: 'development' }, allowed: false },
  { label: 'NODE_ENV=development only', env: { NODE_ENV: 'development' }, allowed: false },
  { label: 'ENVIRONMENT=development + ALLOW_SEED=1', env: { ENVIRONMENT: 'development', ALLOW_SEED: '1' }, allowed: true },
]

let failures = 0
for (const testCase of cases) {
  delete process.env.ENVIRONMENT
  delete process.env.ALLOW_SEED
  delete process.env.NODE_ENV
  for (const [key, value] of Object.entries(testCase.env)) if (value) process.env[key] = value

  let allowed = false
  try {
    assertSeedable()
    allowed = true
  } catch {
    allowed = false
  }
  const ok = allowed === testCase.allowed
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS ' : 'FAIL '} ${allowed ? 'ALLOWED' : 'REFUSED'}  ${testCase.label}  (resolved: ${currentEnvironment()})`,
  )
}

console.log(`\n${failures === 0 ? 'The guard holds.' : `${failures} problem(s).`}`)
process.exit(failures === 0 ? 0 : 1)
