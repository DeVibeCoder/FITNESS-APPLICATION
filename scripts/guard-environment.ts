/**
 * The barrier between fixtures and production.
 *
 * Any script that can write fixture rows calls `assertSeedable()` before it
 * does anything. Two independent things must both be true, because one of
 * them is always a typo away from being wrong:
 *
 *   1. the environment must not be production, and
 *   2. seeding must have been asked for explicitly.
 *
 * The second is what makes the first survive a mistake. `ENVIRONMENT` being
 * unset is treated as production — an unknown environment is the dangerous
 * one, so the default has to be the safe answer rather than the convenient
 * one.
 *
 * This is tooling-side on purpose. A check inside the interface protects
 * nothing: the danger is a developer running a script against the wrong
 * database from a terminal, which no UI condition can see.
 */

export class SeedRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedRefused'
  }
}

/** What the process thinks it is pointed at. Unknown counts as production. */
export function currentEnvironment(): string {
  const explicit = process.env.ENVIRONMENT?.trim().toLowerCase()
  if (explicit) return explicit
  // NODE_ENV is a weak signal — it says how the code was built, not which
  // database is on the other end of the connection. It is read only as a
  // fallback, and only ever to become *more* cautious.
  const node = process.env.NODE_ENV?.trim().toLowerCase()
  if (node === 'development' || node === 'test') return 'development'
  return 'production'
}

export function isProduction(): boolean {
  return currentEnvironment() === 'production'
}

/**
 * Throws unless this process may write fixture data. Call it first, before
 * opening a database or building a single row.
 */
export function assertSeedable(what = 'fixture data'): void {
  const environment = currentEnvironment()

  if (environment === 'production') {
    throw new SeedRefused(
      `Refusing to write ${what}: ENVIRONMENT resolves to "production".\n` +
        'Production is populated by migrations only. If this really is a\n' +
        'development machine, set ENVIRONMENT=development explicitly.',
    )
  }

  if (process.env.ALLOW_SEED !== '1') {
    throw new SeedRefused(
      `Refusing to write ${what}: seeding was not asked for.\n` +
        'Set ALLOW_SEED=1 alongside ENVIRONMENT=development to confirm you\n' +
        'mean it. Two switches, so one wrong terminal cannot do it alone.',
    )
  }
}

/** For scripts that want to report rather than throw. */
export function seedableReason(): { seedable: boolean; reason: string } {
  try {
    assertSeedable()
    return { seedable: true, reason: `environment=${currentEnvironment()}, ALLOW_SEED=1` }
  } catch (error) {
    return { seedable: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
