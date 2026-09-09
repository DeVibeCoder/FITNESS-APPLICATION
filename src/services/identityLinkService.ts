/**
 * The bridge between who you are and whose data this is.
 *
 * Two identities exist and they are deliberately not merged. The server owns
 * authentication: a Better Auth session says which account is signed in, and
 * that is the only thing any protected endpoint trusts. Dexie owns the
 * history: every workout, weigh-in and meal on this device is keyed to a
 * local user id that predates the server entirely.
 *
 * Rewriting those keys would mean touching every row in twenty-one stores to
 * solve a problem that a lookup solves. So nothing is rewritten. A small
 * mapping says which local owner an authenticated account reads, and the
 * existing ownership machinery carries on unchanged behind it.
 *
 * The mapping is local-only and is never a permission. It answers "whose rows
 * on this device?", never "may they?" — the server answers that, every time,
 * and cannot see this file.
 *
 * Stored in the `meta` key/value store the database already has, so this
 * needs no schema version and no migration.
 */
import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import { onboardingService } from './onboardingService'
import type { ID, User } from '@/models'

/** `link:<serverUserId>` → localUserId, and the reverse, so both directions
 * can be checked before anything is claimed. */
const forwardKey = (serverUserId: string) => `link:server:${serverUserId}`
const reverseKey = (localUserId: string) => `link:local:${localUserId}`

export class LinkRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkRefused'
  }
}

/** What signing in on this device should do next. */
export type Resolution =
  | { kind: 'linked'; localUserId: ID }
  | { kind: 'choice'; emailMatch: User | null; localUsers: User[] }

export const identityLinkService = {
  async linkedLocalUserId(serverUserId: string): Promise<ID | null> {
    const row = await db.meta.get(forwardKey(serverUserId))
    return (row?.value as string) ?? null
  },

  async linkedServerUserId(localUserId: ID): Promise<string | null> {
    const row = await db.meta.get(reverseKey(localUserId))
    return (row?.value as string) ?? null
  },

  /**
   * Which local identities are available to claim.
   *
   * Two rules, and the second one was missing.
   *
   * A local user already spoken for by a different account is not offered —
   * that is what stops one cloud account taking another's history.
   *
   * And a row has to be a *local profile* rather than another member of the
   * group. Once the roster started hydrating, `db.users` filled up with
   * everybody else, and every one of them looked like unclaimed history: an
   * administrator signing in was invited to adopt a member's identity and
   * training. Nothing on this device was ever theirs to adopt.
   *
   * Two tests, because one of them has to work on devices that already hold
   * roster rows written before the flag existed. `remote` is set by
   * `cloudSync.hydrateGroup` going forward; the id prefix is the older
   * evidence — a profile authored here is minted by `uid('u')` and starts
   * `u_`, while a server account id never does.
   */
  async availableLocalUsers(serverUserId: string): Promise<User[]> {
    const users = await db.users.toArray()
    const free: User[] = []
    for (const user of users) {
      if (user.remote === true) continue
      if (!user.id.startsWith('u_')) continue
      const owner = await this.linkedServerUserId(user.id)
      if (owner === null || owner === serverUserId) free.push(user)
    }
    return free
  },

  /**
   * What to do when somebody signs in.
   *
   * An existing link is used without asking. Anything else returns a choice
   * for a person to make: an email match is a strong hint and never a
   * decision, because "knows the address" is not "owns the history".
   */
  async resolve(serverUser: { id: string; email?: string | null }): Promise<Resolution> {
    const existing = await this.linkedLocalUserId(serverUser.id)
    if (existing) {
      const stillThere = await db.users.get(existing)
      if (stillThere) return { kind: 'linked', localUserId: existing }
      /*
       * A link pointing at a profile that is gone is stale, not binding — and
       * leaving it in place is a deadlock. `resolve` fell through to the
       * choice screen, and `startFresh` then refused because the link still
       * existed, so the account could neither carry on nor begin again: "a new
       * profile could not be created", on every attempt, for good.
       *
       * Clearing it is what lets the next line create a profile.
       */
      await this.unlink(serverUser.id)
    }

    const localUsers = await this.availableLocalUsers(serverUser.id)
    const email = serverUser.email?.trim().toLowerCase()
    const matches = email
      ? localUsers.filter((user) => user.email?.trim().toLowerCase() === email)
      : []

    return {
      kind: 'choice',
      // Exactly one match is a hint worth showing. Two are ambiguous, and
      // guessing between them is precisely the mistake to avoid.
      emailMatch: matches.length === 1 ? matches[0] : null,
      localUsers,
    }
  },

  /**
   * Claims a local identity for an account. Deliberate, and refused when it
   * would take something already spoken for.
   */
  async link(serverUserId: string, localUserId: ID): Promise<void> {
    const local = await db.users.get(localUserId)
    if (!local) throw new LinkRefused('That local profile no longer exists on this device.')

    const currentOwner = await this.linkedServerUserId(localUserId)
    if (currentOwner && currentOwner !== serverUserId) {
      throw new LinkRefused('That data already belongs to a different account on this device.')
    }

    const currentTarget = await this.linkedLocalUserId(serverUserId)
    if (currentTarget && currentTarget !== localUserId) {
      throw new LinkRefused('This account is already using different data on this device.')
    }

    await db.transaction('rw', db.meta, async () => {
      await db.meta.put({ key: forwardKey(serverUserId), value: localUserId })
      await db.meta.put({ key: reverseKey(localUserId), value: serverUserId })
    })
  },

  /**
   * Starts clean: a new local profile for this account, with every existing
   * one left exactly as it was.
   *
   * Setup's answers are used when this device still has them — the same
   * person, the same browser, however long ago they asked to join. When it
   * does not, the profile is created with plain defaults rather than being
   * refused: an approval that arrives on a different device is a perfectly
   * ordinary thing to happen, and the profile screen can change any of this.
   *
   * The answers are consumed here and only here. They describe a body, not a
   * permission — nothing in them can set `role` or `status`, which are columns
   * on the server's row and are not writable from this side at all.
   */
  async startFresh(
    serverUser: { id: string; name?: string | null; email?: string | null },
    /**
     * What the server already knows about this person, when it knows anything.
     *
     * Takes precedence over both setup's answers and the defaults, because it
     * is the record — a device linking an existing account is joining a
     * profile, not authoring one. Without this a second device invented a
     * placeholder and then pushed it up, replacing a real height and goal in
     * D1 with 175cm and 80kg.
     */
    seed?: Partial<User> | null,
  ): Promise<ID> {
    const existing = await this.linkedLocalUserId(serverUser.id)
    if (existing) throw new LinkRefused('This account already uses data on this device.')

    const answers = await onboardingService.take(serverUser.id)
    const id = uid('u')
    const timestamp = now()
    const user: User = {
      id,
      name: serverUser.name?.trim() || 'New member',
      handle: answers?.handle ?? `member_${id.slice(-6)}`,
      email: serverUser.email ?? undefined,
      avatarColor: answers?.avatarColor ?? '#c2410c',
      birthDate: answers?.birthDate ?? '1990-01-01',
      sex: answers?.sex ?? 'male',
      heightCm: answers?.heightCm ?? 175,
      startWeightKg: answers?.startWeightKg ?? 80,
      targetWeightKg: answers?.targetWeightKg ?? 75,
      goal: answers?.goal ?? 'general_fitness',
      activityLevel: answers?.activityLevel ?? 'moderate',
      stepGoal: answers?.stepGoal ?? 8000,
      waterGoalL: answers?.waterGoalL ?? 2.5,
      workoutsPerWeekGoal: answers?.workoutsPerWeekGoal ?? 4,
      weighInDay: answers?.weighInDay ?? 0,
      workoutApps: answers?.workoutApps ?? [],
      units: answers?.units ?? 'metric',
      onboardedAt: answers ? timestamp : undefined,
      joinedAt: timestamp,
    }

    // The server's own values last, so they win over anything invented above.
    await db.users.add({ ...user, ...(seed ?? {}), id, email: user.email })
    await this.link(serverUser.id, id)
    return id
  },

  /** Forgets the mapping only. No history is touched. */
  async unlink(serverUserId: string): Promise<void> {
    const localUserId = await this.linkedLocalUserId(serverUserId)
    await db.transaction('rw', db.meta, async () => {
      await db.meta.delete(forwardKey(serverUserId))
      if (localUserId) await db.meta.delete(reverseKey(localUserId))
    })
  },
}
