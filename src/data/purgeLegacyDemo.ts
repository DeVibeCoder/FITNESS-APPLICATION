import { db } from '@/lib/db'
import { storageService } from '@/services/storageService'

/**
 * Removing the demo group from devices that already have it.
 *
 * Taking the fixture out of `src` stopped new devices from ever receiving it.
 * It did nothing about the ones that already had — and that is most of them,
 * because every build before this one seeded three invented people, their
 * months of training, their chat and their posts into the browser's IndexedDB
 * on first run. A published bundle that no longer contains the demo is not the
 * same thing as a phone that no longer contains the demo.
 *
 * So this is the other half. It runs once, on boot, before anything reads a
 * profile, and it clears the local database on any device carrying the
 * fixture — because on such a device the entire local database *is* the
 * fixture. That was the whole point of the seed: it was not three users beside
 * real data, it was three users and every row that belonged to them.
 *
 * Clearing everything rather than deleting four user rows is deliberate. The
 * seed wrote into twenty-seven tables, and a user-by-user delete has to know
 * all of them and stay correct as the schema grows — the first row it misses
 * is a workout owned by a person who no longer exists, which every screen that
 * joins on a user then has to survive. Emptying the cache has no such list to
 * get wrong.
 *
 * Nothing real is lost by this. Since the backend arrived, Dexie is a cache:
 * D1 is the record, and `cloudSync.hydrate` pulls an approved account's rows
 * back down on the next sign-in. The rows this deletes are precisely the ones
 * that were never in D1, because they were invented on the device.
 *
 * It runs once and then cannot run again, because the markers it looks for are
 * among the things it clears.
 */

/**
 * The four fixture accounts, by the ids the seed gave them.
 *
 * Hard-coded, and that is the right shape: this is a list of specific rows
 * shipped by specific past versions, not a rule about what a user may be
 * called. Somebody genuinely named Ahmed keeps their account — it is a row in
 * D1 with a generated id, and nothing here can reach it.
 */
const FIXTURE_USER_IDS = ['u_ahmed', 'u_nadia', 'u_samir', 'u_leila']

/** Written by the old `seedDatabase`, and by nothing else. */
const FIXTURE_META_KEYS = ['seedVersion', 'seededOn']

/**
 * Whether this device was seeded by a build that still had the demo.
 *
 * Two independent signals, because either can be missing on its own. A device
 * part-way through an old upgrade can hold the users without the marker, and a
 * device whose users were deleted by hand can hold the marker without the
 * users. Either is enough.
 */
export async function hasLegacyDemoData(): Promise<boolean> {
  for (const key of FIXTURE_META_KEYS) {
    if ((await db.meta.get(key)) !== undefined) return true
  }
  for (const id of FIXTURE_USER_IDS) {
    if ((await db.users.get(id)) !== undefined) return true
  }
  return false
}

/**
 * Empties the local cache, if this device is carrying the demo.
 *
 * Returns whether it did anything, so the caller can say so — a boot that
 * silently deletes a database is worse than one that mentions it.
 *
 * Never throws. A device that cannot be cleaned still has to start: failing
 * here would turn "you can see some invented people" into "the app does not
 * open", which is a worse outcome for the same underlying problem.
 */
export async function purgeLegacyDemoData(): Promise<boolean> {
  let carrying: boolean
  try {
    carrying = await hasLegacyDemoData()
  } catch {
    return false
  }
  if (!carrying) return false

  try {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()))
    })

    /*
     * The session pointer lives in localStorage, not in Dexie, so clearing the
     * tables leaves it behind — pointing at a demo profile that is now gone.
     * `AuthProvider` would read it, find nothing, and carry on; but leaving a
     * dangling id in storage because it happens to be harmless is how it stops
     * being harmless later.
     */
    storageService.setSessionUserId(null)

    // Written after the clear, so it survives it. Its presence is also what
    // makes a second run impossible: the markers above are gone.
    await db.meta.put({ key: 'demoPurgedAt', value: new Date().toISOString() })
    return true
  } catch {
    return false
  }
}
