/** Phase 9: the linking flow, in a real browser against the real Worker. */
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const require = createRequire('C:/Users/ultimanium/AppData/Roaming/npm/node_modules/@playwright/mcp/')
const { chromium } = require('playwright-core')
const EXE = 'C:/Users/ultimanium/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:5173'
const NL = String.fromCharCode(10)
const say = (m) => {
  appendFileSync('link-e2e.txt', String(m) + NL)
  console.log(m)
}
const fails = []
const ok = (c, l, d) => {
  say(`${c ? 'PASS ' : 'FAIL '} ${l}${d === undefined ? '' : ' — ' + JSON.stringify(d)}`)
  if (!c) fails.push(l)
}
const d1 = (sql) =>
  execSync(
    `npx wrangler d1 execute circuit-dev --env preview --local --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 8e6, stdio: ['ignore', 'pipe', 'ignore'] },
  )
const query = (sql) => {
  const out = d1(sql)
  return JSON.parse(out.slice(out.indexOf('['))).flatMap((b) => b.results ?? [])
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })

/** Signs an account up through the real API from inside the page. */
async function register(page, email) {
  return page.evaluate(
    async ([email]) => {
      const r = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: 'a-long-enough-password-1', name: 'Linker' }),
      })
      return { status: r.status, body: await r.text() }
    },
    [email],
  )
}
async function login(page, email) {
  return page.evaluate(
    async ([email]) => {
      const r = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: 'a-long-enough-password-1' }),
      })
      return { status: r.status }
    },
    [email],
  )
}

const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.setDefaultTimeout(20000)
const errs = []
page.on('pageerror', (e) => errs.push('UNCAUGHT ' + String(e).slice(0, 160)))
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' && !/Failed to load resource/i.test(t)) errs.push('CONSOLE ' + t.slice(0, 160))
})

// --- 1. A device that already holds history -------------------------------
say('=== 1. existing local history on this device ===')
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const seeded = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('circuit')
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['users', 'sessions'], 'readonly')
        const users = tx.objectStore('users').getAll()
        const sessions = tx.objectStore('sessions').count()
        tx.oncomplete = () =>
          resolve({ users: users.result.map((u) => ({ id: u.id, name: u.name, email: u.email })), sessions: sessions.result })
      }
    }),
)
say('   local profiles: ' + JSON.stringify(seeded.users.map((u) => u.id)))
say('   workout sessions on device: ' + seeded.sessions)
ok(seeded.users.length > 0 && seeded.sessions > 0, '1. the device holds real local history', seeded.sessions)
const target = seeded.users[0]

// --- 2/3/4. Real account, approved, logged in -----------------------------
say(NL + '=== 2-4. real server account ===')
const email = `link_${Date.now()}@circuit.test`
const signUp = await register(page, email)
ok(signUp.status === 200, '2. signup through the real API', signUp.status)
// The linking flow does not need approval: status gates the scan endpoints,
// not the session or the link screen. Checked through the API instead of a
// second wrangler process, which crashes on the database file the running
// Worker holds open.
const whoami = await page.evaluate(async () => {
  const r = await fetch('/api/auth/get-session', { credentials: 'include' })
  return await r.json()
})
ok(whoami?.user?.status === 'pending', '3. the new account starts pending', whoami?.user?.status)
const signIn = await login(page, email)
ok(signIn.status === 200, '4. login', signIn.status)

// --- 5. The link screen ---------------------------------------------------
say(NL + '=== 5. the account-link screen ===')
// Navigate to the app root: /login is a public route outside the auth gate,
// so reloading it renders the local login form even with a server session.
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const screen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
ok(/Signed in as/i.test(screen) && /Use this data on this device/i.test(screen), '5. the link screen is shown', screen.slice(0, 120))
ok(/Start fresh instead/i.test(screen), '5. and offers starting fresh')
await page.screenshot({ path: 'link-screen.png' })

// --- 6/7. Use existing data ----------------------------------------------
say(NL + '=== 6-7. use my existing data ===')
// Nothing is pre-selected when no email matches, which is the intended
// behaviour: the screen never guesses. Pick the profile first.
const targetName = target.name
await page.getByRole('button', { name: new RegExp(targetName, 'i') }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /use this data on this device/i }).click()
await page.waitForTimeout(3000)
const afterLink = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
ok(!/Use this data on this device/i.test(afterLink), '6. the link screen is gone')
ok(afterLink.length > 200, '7. the application rendered', afterLink.length)
const linked = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('circuit')
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('meta', 'readonly')
        const all = tx.objectStore('meta').getAll()
        tx.oncomplete = () => resolve(all.result.filter((r) => String(r.key).startsWith('link:')))
      }
    }),
)
say('   link rows written: ' + JSON.stringify(linked))
ok(linked.some((r) => String(r.key).startsWith('link:server:') && r.value === target.id), '6. the link points at the existing profile')
ok(linked.some((r) => String(r.key) === `link:local:${target.id}`), '6. and the reverse mapping exists')

const historyVisible = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('circuit')
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('sessions', 'readonly')
        const c = tx.objectStore('sessions').count()
        tx.oncomplete = () => resolve(c.result)
      }
    }),
)
ok(historyVisible === seeded.sessions, '7. the same history is still on the device', [seeded.sessions, historyVisible])

// --- 10-14. Reload --------------------------------------------------------
say(NL + '=== 10-14. full reload ===')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
ok(!/Signed in as .*Use this data/i.test(after), '11/12. the link is remembered — no second question')
ok(after.length > 200, '13. the application rendered again', after.length)
const session = await page.evaluate(async () => {
  const r = await fetch('/api/auth/get-session', { credentials: 'include' })
  const b = await r.json()
  return b?.user?.email ?? null
})
ok(session === email, '11. the server session survived the reload', session)
const stillLinked = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('circuit')
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['meta', 'sessions'], 'readonly')
        const meta = tx.objectStore('meta').getAll()
        const count = tx.objectStore('sessions').count()
        tx.oncomplete = () =>
          resolve({ link: meta.result.filter((r) => String(r.key).startsWith('link:server:'))[0]?.value ?? null, sessions: count.result })
      }
    }),
)
ok(stillLinked.link === target.id, '12. the same account resolves to the same local profile', stillLinked.link)
ok(stillLinked.sessions === seeded.sessions, '13/14. the history is still all there', [seeded.sessions, stillLinked.sessions])

// --- localStorage cannot change who you are -------------------------------
say(NL + '=== security: localStorage ===')
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const afterClear = await page.evaluate(async () => {
  const r = await fetch('/api/auth/get-session', { credentials: 'include' })
  const b = await r.json()
  return { email: b?.user?.email ?? null, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 90) }
})
ok(afterClear.email === email, 'clearing localStorage does not log you out of the server', afterClear.email)
ok(!/Sign in|Welcome back/i.test(afterClear.text), 'and the app did not bounce to the local login', afterClear.text)

// --- 15/16. Logout --------------------------------------------------------
say(NL + '=== 15-16. logout ===')
await page.evaluate(async () => {
  await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}' })
})
const gone = await page.evaluate(async () => {
  const r = await fetch('/api/workout-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ imageBase64: 'aGk=', mimeType: 'image/png' }),
  })
  return { status: r.status, body: await r.json() }
})
ok(gone.status === 401 && gone.body.error === 'unauthenticated', '16. protected endpoints refuse after logout', gone.body.error)

ok(errs.length === 0, 'no console errors', JSON.stringify([...new Set(errs)].slice(0, 3)))
await ctx.close()

// --- Start fresh, in a clean browser profile ------------------------------
say(NL + '=== start fresh (separate account, fresh browser) ===')
const ctx2 = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true, isMobile: true })
const p2 = await ctx2.newPage()
p2.setDefaultTimeout(20000)
await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(3500)
const before2 = await p2.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('circuit')
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['users', 'sessions'], 'readonly')
        const u = tx.objectStore('users').count()
        const s = tx.objectStore('sessions').count()
        tx.oncomplete = () => resolve({ users: u.result, sessions: s.result })
      }
    }),
)
const email2 = `fresh_${Date.now()}@circuit.test`
await register(p2, email2)
await login(p2, email2)
await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(3000)
await p2.getByRole('button', { name: /start fresh instead|^continue$/i }).click()
await p2.waitForTimeout(3000)
const after2 = await p2.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('circuit')
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['users', 'sessions', 'meta'], 'readonly')
        const u = tx.objectStore('users').count()
        const s = tx.objectStore('sessions').count()
        const m = tx.objectStore('meta').getAll()
        tx.oncomplete = () =>
          resolve({
            users: u.result,
            sessions: s.result,
            link: m.result.filter((r) => String(r.key).startsWith('link:server:'))[0]?.value ?? null,
          })
      }
    }),
)
say('   before: ' + JSON.stringify(before2) + '  after: ' + JSON.stringify(after2))
ok(after2.users === before2.users + 1, 'start fresh added exactly one profile', [before2.users, after2.users])
ok(after2.sessions === before2.sessions, 'and copied no history', [before2.sessions, after2.sessions])
ok(Boolean(after2.link) && after2.link !== target.id, 'the fresh account got a new local identity', after2.link)
await p2.screenshot({ path: 'fresh-result.png' })
await ctx2.close()

await browser.close()
say(NL + (fails.length === 0 ? 'THE BROWSER FLOW WORKS.' : fails.length + ' FAILURE(S)'))
fails.forEach((f) => say('  - ' + f))
process.exit(fails.length === 0 ? 0 : 1)
