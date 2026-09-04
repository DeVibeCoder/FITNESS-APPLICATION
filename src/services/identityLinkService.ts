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
   * A local user already spoken for by a different account is not offered —
   * that is the rule that stops one cloud account taking another's history.
   */
  async availableLocalUsers(serverUserId: string): Promise<User[]> {
    const users = await db.users.toArray()
    const free: User[] = []
    for (const user of users) {
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
      // A link pointing at a user that no longer exists is stale, not binding.
      const stillThere = await db.users.get(existing)
      if (stillThere) return { kind: 'linked', localUserId: existing }
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
   */
  async startFresh(serverUser: { id: string; name?: string | null; email?: string | null }): Promise<ID> {
    const existing = await this.linkedLocalUserId(serverUser.id)
    if (existing) throw new LinkRefused('This account already uses data on this device.')

    const id = uid('u')
    const timestamp = now()
    const user: User = {
      id,
      name: serverUser.name?.trim() || 'New member',
      handle: `member_${id.slice(-6)}`,
      email: serverUser.email ?? undefined,
      avatarColor: '#c2410c',
      birthDate: '1990-01-01',
      sex: 'male',
      heightCm: 175,
      startWeightKg: 80,
      targetWeightKg: 75,
      goal: 'general_fitness',
      activityLevel: 'moderate',
      stepGoal: 8000,
      waterGoalL: 2.5,
      workoutsPerWeekGoal: 4,
      weighInDay: 0,
      workoutApps: [],
      units: 'metric',
      joinedAt: timestamp,
    }

    await db.users.add(user)
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
