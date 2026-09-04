/**
 * The AI endpoints, checked at the door.
 *
 * These are the expensive routes: each successful request costs a Gemini
 * call. Until this phase anyone who knew the URL could spend that, which is
 * exactly how Phases 33 and 35 tested them.
 *
 * No live Gemini calls happen here. Refusals never reach the provider because
 * the guard runs before the body is even parsed, and the "allowed" cases are
 * proven by sending a deliberately malformed body: an approved user who gets
 * `invalid_image` back has passed authentication and stopped at validation,
 * which is precisely what we want to know and costs nothing.
 *
 *   npm run db:check:ai
 */
import { onRequestPost as workoutScan } from '../functions/api/workout-scan'
import { onRequestPost as foodScan } from '../functions/api/food-scan'

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

const future = new Date(Date.now() + 3_600_000).toISOString()
const USERS: Record<string, { id: string; handle: string; name: string; email: string | null; role: string; status: string }> = {
  t_approved: { id: 'u1', handle: 'ada', name: 'Ada', email: 'a@x.dev', role: 'member', status: 'approved' },
  t_pending: { id: 'u2', handle: 'bo', name: 'Bo', email: 'b@x.dev', role: 'member', status: 'pending' },
  t_rejected: { id: 'u3', handle: 'cy', name: 'Cy', email: 'c@x.dev', role: 'member', status: 'rejected' },
  t_disabled: { id: 'u4', handle: 'di', name: 'Di', email: 'd@x.dev', role: 'member', status: 'disabled' },
}

const DB = {
  prepare() {
    return {
      bind(token: unknown) {
        return { async first() { return USERS[String(token)] ?? null } }
      },
    }
  },
}

// No provider keys: if a refusal ever leaked past the guard, the handler
// could not call anything anyway. Belt as well as braces.
const env = { DB, GEMINI_API_KEY: undefined, FDC_API_KEY: undefined } as never

const post = (token: string | undefined, body: string) =>
  new Request('https://circuit.test/api/scan', {
    method: 'POST',
    headers: token ? { Cookie: `circuit.session_token=${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body,
  })

const valid = JSON.stringify({ imageBase64: 'aGk=', mimeType: 'image/png' })

async function run(name: string, fn: typeof workoutScan) {
  console.log(`\n--- ${name} ---`)

  for (const [label, token, expected] of [
    ['L/M. anonymous', undefined, 'unauthenticated'],
    ['pending user', 't_pending', 'pending'],
    ['rejected user', 't_rejected', 'rejected'],
    ['disabled user', 't_disabled', 'disabled'],
    ['unknown session', 't_bogus', 'unauthenticated'],
  ] as const) {
    const res = await fn({ request: post(token, valid), env })
    const payload = (await res.json()) as { error?: string }
    check(`${label} is refused (${res.status} ${payload.error})`, payload.error === expected && (res.status === 401 || res.status === 403))
  }

  // Approved: must pass the guard. Malformed body proves it got past auth
  // and stopped at validation, without a provider call.
  const res = await fn({ request: post('t_approved', '{ not json'), env })
  const payload = (await res.json()) as { error?: string }
  check(`N/O. approved user passes authentication (stopped at validation: ${payload.error})`, payload.error === 'invalid_image' && res.status === 400)

  // No database bound: the endpoint must fail closed, not open.
  const noDb = await fn({ request: post('t_approved', valid), env: { GEMINI_API_KEY: 'x' } as never })
  const noDbPayload = (await noDb.json()) as { error?: string }
  check('with no DB bound the endpoint refuses rather than falling open', noDb.status === 401 && noDbPayload.error === 'unauthenticated')
}

async function main() {
  await run('workout-scan', workoutScan)
  await run('food-scan', foodScan as typeof workoutScan)
  console.log(`\n${failures === 0 ? 'The AI endpoints are closed to anonymous callers.' : `${failures} problem(s).`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
