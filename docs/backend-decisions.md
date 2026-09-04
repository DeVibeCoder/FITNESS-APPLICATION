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

Everything in `src/data/seed.ts` is a fixture and reaches no server. The
barrier is in `scripts/guard-environment.ts` and needs two independent things
to be true at once — see the phase report.
