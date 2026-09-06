/**
 * Whether this build is allowed to invent people.
 *
 * The application ships with a demo group — three named accounts, a shared
 * password printed on the sign-in screen, months of invented workouts, meals,
 * posts and chat. That content is what makes the app explorable on a laptop
 * with no server, and it is exactly what must never appear in production: a
 * real person signing up should not find three strangers already in their
 * group, and a published bundle should not carry a password that logs anyone
 * into any of them.
 *
 * So it is a build-time decision, not a runtime one. `import.meta.env.DEV` is
 * a constant Vite substitutes and Rollup then folds, which means in a
 * production build the branch is false, the dynamic `import()` behind it is
 * never reachable, and the demo module — names, password, every seeded row —
 * is not in the output at all. Not hidden. Absent.
 *
 * The escape hatch is deliberate and explicit: `VITE_DEMO_DATA=1` at build
 * time produces a demo build on purpose, which is how the offline fallback is
 * exercised. It cannot be switched on afterwards by a query string, a flag in
 * storage or anything else a visitor controls.
 */
export const demoDataEnabled: boolean =
  import.meta.env.DEV || import.meta.env.VITE_DEMO_DATA === '1'
