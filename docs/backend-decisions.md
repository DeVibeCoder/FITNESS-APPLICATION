# Backend decisions

Decisions taken in Backend Phase 2 that later phases depend on. Each records
what was chosen, what it was chosen over, and what it costs.

---

## 1. Offline strategy — Hybrid, with an append-only write queue

**Chosen: B (Hybrid).** The cloud is authoritative. Dexie stays as a local
read cache, and a narrow write queue covers the writes that genuinely happen
away from signal.

The app is used in a gym. Phases 21, 22 and 34 all verified that it opens and
works offline today, and that came for free because Dexie held everything.
Going online-first would trade a proven capability for a simpler diagram, and
the first time someone loses a set at the bottom of a basement gym the trade
looks bad.

Full bidirectional sync is not what is being signed up for, though. The queue
is deliberately limited to operations that **cannot conflict** because they
only ever add:

- logging a set during a workout
- adding water
- adding steps
- creating a workout session

Everything that depends on server state — editing, deleting, reacting,
posting, anything social — requires connectivity and says so plainly. Those
are rare when offline and ambiguous to merge, which is exactly the combination
that makes a sync engine expensive and unreliable.

So: conflict-free by construction rather than by resolution. Reads come from
the cache and are refreshed on reconnect; queued writes replay in order and
are idempotent through the ids the client already generates.

**Cost:** two code paths for the offline-capable writes, and a cache that can
be stale. **Not now:** none of this is built in this phase, and Dexie is not
touched.

---

## 2. Authentication library — Better Auth

**Chosen: Better Auth**, running inside Pages Functions with a D1 adapter.

**Over Auth.js.** Auth.js is excellent at OAuth and would handle Google
perfectly well, but its credentials provider deliberately stops short of
owning passwords: no user creation, no password storage, no reset flow. Since
email/password *and* account recovery are both requirements, choosing Auth.js
means writing the password half by hand — which is the half where mistakes are
expensive.

**Over Cloudflare Access.** Rejected in Phase 1: it gates an application
behind an IdP rather than giving an application its own accounts, and has no
concept of an app-level pending user.

**Over hosted identity (Clerk, Auth0, WorkOS).** Rejected as an extra vendor
and a per-seat cost for a three-person group, when the brief is to stay on
Cloudflare.

### How it fits

- **D1** — the tables already exist in migration `0001_identity.sql`:
  `users`, `auth_accounts`, `auth_sessions`, `auth_verification_tokens`. They
  are shaped to the standard adapter layout: one user row, one row per
  credential, one row per session.
- **Sessions** — an opaque token in an `httpOnly; Secure; SameSite=Lax`
  cookie, matched against `auth_sessions.token`, with an expiry and rotation
  on privilege change. The cookie never carries a user id, and no handler
  reads an identity from a request body.
- **Google** — the standard OAuth code flow terminating in the Worker. A first
  Google sign-in creates a `pending` user exactly as email signup does; having
  a Google account is not an approval.
- **Admin approval** — `users.status` starts `pending`. Only `approved` passes
  the group-data guard. Admin endpoints check `role = 'admin'` against the
  session's user row, server-side. The first admin is promoted once by hand
  with `wrangler d1 execute`, so no privileged credential lives in the code.

### The one thing to confirm before building on it

Better Auth's default password hashing is scrypt, which is deliberately
CPU-expensive, and Workers bill CPU. **Measure it against the CPU budget
first.** If it does not fit, the hashing is configurable — PBKDF2-HMAC-SHA-256
through `crypto.subtle` with a high iteration count is the Workers-native
fallback. This is the risk flagged in Phase 1 and it has not been retired yet,
only assigned an owner.

---

## 3. Production initialization — migrations only

Production starts with the exercise catalogue and the achievement definitions
and nothing else. Both are generated into `migrations/0004_reference_data.sql`
from the same catalogues the interface reads, so the two cannot drift.

Everything in `scripts/fixtures/` is a fixture and reaches no server, and no
browser either. There are two independent barriers and they guard different
things:

- **Against a fixture reaching a database** — `scripts/guard-environment.ts`,
  which needs `ENVIRONMENT=development` *and* `ALLOW_SEED=1` before any script
  will write a row. An unset environment counts as production.
- **Against a fixture reaching a user** — the directory. `src` imports nothing
  from `scripts/fixtures`, so Rollup's graph never arrives there: the fixture
  group, its shared password and the local sign-in that used to check it are
  not in a build, not behind a flag, and not one wrong branch away from being.
  `npm run check:bundle` reads `dist` and says so.

---

## 4. Production infrastructure (Backend Phase 11)

### Databases

| | Development | Production |
|---|---|---|
| D1 name | `circuit-dev` | `circuit-prod` |
| D1 id | `722c4aba-…` | `9247acf9-…` |
| R2 bucket | `circuit-media-dev` *(blocked)* | `circuit-media-prod` *(blocked)* |

Different names **and** different ids on purpose, so a copied command line
cannot quietly point one environment at the other's data.

Production was created empty and initialised from the committed migrations
alone. It holds 24 exercises and 31 achievement definitions — facts about the
application, not about any person — and zero users, accounts, sessions,
workouts, meals, posts, stories, messages, groups, updates or notifications.

Checked with the same assertions the development database gets:

```
DB_NAME=circuit-prod DB_ENV=production npx tsx --tsconfig tsconfig.app.json \
  scripts/check-dev-db.ts
```

### R2 — blocked, not worked around

`wrangler r2 bucket create` fails for both environments with:

> A request to the Cloudflare API (/accounts/…/r2/buckets) failed.
> Please enable R2 through the Cloudflare Dashboard. [code: 10042]

R2 has never been enabled on this account, which is a dashboard action with
billing terms attached — not something to automate around. Both bindings are
written into `wrangler.toml` and commented out, with the command needed to
finish. A binding naming a bucket that does not exist fails the deploy, so
they stay commented rather than shipping broken.

### Secrets

Set in production (values never printed, never in source):

- `GEMINI_API_KEY` — encrypted, in use by the analysis endpoints
- `FDC_API_KEY` — encrypted, in use by the nutrition lookup

Deliberately **not** set, so a premature deploy cannot switch authentication
on before the frontend is ready — `/api/auth` answers 503 without it, which
is the safe state:

- `AUTH_SECRET` — generate with `openssl rand -base64 32`, then
  `wrangler pages secret put AUTH_SECRET --project-name fitness-application`

Not available yet, and not faked:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — no OAuth client exists
- password-reset email — no provider chosen; the reset hook throws rather
  than pretending to send

`.dev.vars` is local-only and gitignored. It is never copied to production.

### The administrator

There is no admin account and no admin credential anywhere in the codebase,
and there is no code path that creates one. `role` defaults to `'member'` on
the column, Better Auth is configured with `input: false` on both `role` and
`status`, and the profile route's writable-column list names neither — so
nothing a client can send reaches either field.

The one production administrator is **flowingdeknight@gmail.com**. It was made
the way anybody else's account is made:

1. Sign up through `/api/auth/sign-up/email` with a generated password. It
   arrives `pending` and `member`, as everyone does.
2. Promote it once, out of band, against the production database:

   ```
   wrangler d1 execute circuit-prod --env production --remote --command \
     "UPDATE users SET status='approved', role='admin' WHERE email='<their email>';"
   ```

3. Confirm exactly one row, and that it is the right one:

   ```
   wrangler d1 execute circuit-prod --env production --remote --command \
     "SELECT id, email, role, status FROM users WHERE role='admin';"
   ```

The password was generated from `crypto.randomBytes`, written once to a file
outside the repository, and never printed, logged, committed or passed on a
command line. It is not recoverable from anything in here — if it is lost, the
account is deleted and made again.

Every admin after the first is promoted through the admin screen, which reads
`role` from the session's own user row server-side.

**What being an administrator is.** It is the routes under `/api/admin`, and
nothing else: approve, reject, disable. There is no admin route that reads or
writes another person's workouts, meals, posts or messages, because every
ownership-scoped route in the rest of the server resolves its owner from the
session and takes no user id from anywhere. An admin calling a member route
acts as themselves — not because a check forbids otherwise, but because there
is no parameter that could ask. And an admin cannot decide about their own
account: the `UPDATE` carries `AND id <> ?` on the acting admin, so it is
refused by the statement rather than by remembering to.

### Approval, and how a waiting screen stops waiting

`status` starts `pending`, and `requireApprovedUser` refuses anything that is
not `approved` on every protected request — reading the column, not a claim in
a cookie, a body or a header. A pending session is real, and it can do exactly
one thing: read its own status.

A decision takes effect on the *next request*, not the next sign-in. There is
no approval state in the session token to go stale. Rejecting or disabling
additionally deletes that account's rows from `auth_sessions`, so an open tab
is refused at once rather than whenever a cookie happens to expire.

On the client, `AuthProvider` re-asks `/api/auth/get-session` — every four
seconds while an account is not approved, every minute once it is, and
immediately when the tab regains focus or the network comes back. When the
answer changes from `pending` to `approved`, the waiting screen stops being
rendered and the application appears, with nobody having reloaded anything.

This is polling, deliberately. The Durable Object in `workers/chat-realtime` is
the conversation's, and the route to it refuses any account that is not already
approved — so the one event that matters here is the one event it could never
carry. More to the point, the transport is not what makes this safe: the client
learns nothing from a signal except *when to ask*, and the answer always comes
from the authenticated API reading the `users` row. A socket frame saying "you
are approved" would be a payload to trust, and there is nothing here that
trusts one.

### Google OAuth — not production-ready

The provider is configured in code and switches on only when both credentials
are present. Before it can work, an OAuth 2.0 Web application client must be
created and this exact callback registered:

```
https://fitness-application-7vt.pages.dev/api/auth/callback/google
```

The authorised JavaScript origin is the same URL without the path. **If the
production domain ever changes, this callback must change with it** or sign-in
fails at the redirect with a mismatch error.
