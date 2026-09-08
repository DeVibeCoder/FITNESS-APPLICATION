# Test fixtures

Nothing in this directory is part of the application.

It holds the invented group — three named accounts, a shared password, months
of made-up workouts, meals, posts and chat — that `npm run verify` runs its
four thousand assertions against. That data used to live in `src/data`, which
meant a build could reach it: a wrong flag, a stale branch or a forgotten
`import` was all that stood between a published bundle and a printed password
that logged anyone into any of three accounts.

So the barrier is no longer a flag. It is the directory.

`src` imports nothing from here, and cannot: Rollup's graph starts at
`index.html` → `src/main.tsx`, and no path through it arrives at this folder.
There is no build-time constant to get wrong and no environment variable that
turns it on. The fixture is unreachable from the application in the same way a
file on another machine is.

`scripts/verify-data.ts` imports it directly, because that script is Node
tooling run from a terminal against `fake-indexeddb` — it never touches a real
browser, a real server or a real database.

The reference data the application genuinely needs at runtime — the exercise
catalogue and the plan templates — is **not** here. It lives in
`src/data/library.ts` and is installed into the local cache by
`src/data/reference.ts`, because it is a fact about the app rather than about
any invented person.
