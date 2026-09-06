/**
 * How a linked account's data reaches D1, and how it comes back.
 *
 * The application has one reactive read path — Dexie, through `useLiveQuery`,
 * from roughly a hundred components — and rewriting all of it to await a
 * network call would be a far bigger change than moving the data. So the
 * arrangement is deliberately the smaller one:
 *
 *   D1 is the durable record. Dexie is this device's cache of it.
 *
 * A write in cloud mode goes to Dexie exactly as it always did, and the same
 * row is pushed to D1 under the same id — the client picks ids, so a row has
 * one identity in both places and a retry lands on the row it already wrote
 * rather than making a second one. Signing in on a new device pulls the
 * account's rows down into that device's cache. Screens are untouched.
 *
 * What this deliberately does NOT do is upload a device's existing history.
 * Rows written before an account was linked stay where they are. Deciding
 * which of a shared demo database's rows are legitimately one person's is a
 * question with real answers required, and inventing one silently — at the
 * moment somebody signs in, with no way to undo it — is how a migration
 * destroys data it was only asked to move.
 *
 * A push that fails does not fail the user's action. The local write already
 * happened, the app keeps working offline as a PWA must, and the failure is
 * remembered so the next successful call can carry it. Nothing is lost from
 * this device; what is lost is only the guarantee that another device sees it
 * yet, which is exactly what being offline means.
 */
import { db } from '@/lib/db'
import type { ID } from '@/models'
import { cloudDataService, CloudDataError } from './cloudDataService'

let enabled = false
/** The profile this device knows the signed-in person by. */
let profileId: ID | null = null
/**
 * The signed-in account's server id, so hydrate can tell the viewer's own
 * social rows from everybody else's.
 */
let serverSelf: ID | null = null

/** Pushes that did not land. Retried before the next one, then dropped. */
const outbox: { path: string; payload: unknown }[] = []

const shelve = (path: string, payload: unknown) => {
  // Bounded: an outbox that grows without limit during a long offline spell
  // is a memory leak, and the local row is safe regardless.
  if (outbox.length >= 100) outbox.shift()
  outbox.push({ path, payload })
}

async function drain(): Promise<void> {
  while (outbox.length > 0) {
    const next = outbox[0]
    try {
      await cloudDataService.post(next.path, next.payload)
      outbox.shift()
    } catch {
      return
    }
  }
}

export const cloudSync = {
  /** Called by AuthContext once it knows what kind of session this is. */
  useCloud(on: boolean, localUserId: ID | null = null, serverUserId: ID | null = null): void {
    enabled = on
    profileId = on ? localUserId : null
    serverSelf = on ? serverUserId : null
    if (!on) outbox.length = 0
  },

  enabled(): boolean {
    return enabled
  },

  /** For the checks: how many writes have not reached the server. */
  pending(): number {
    return outbox.length
  },

  /**
   * Sends one row. Never throws: the caller has already written locally, and
   * an action the user completed must not fail because a network did.
   */
  async push(path: string, payload: unknown): Promise<void> {
    if (!enabled) return
    try {
      await drain()
      await cloudDataService.post(path, payload)
    } catch (error) {
      shelve(path, payload)
      if (error instanceof CloudDataError && error.kind === 'unauthenticated') {
        // The session went away underneath us. Stop pretending otherwise.
        enabled = false
      }
    }
  },

  /**
   * Sends a profile edit.
   *
   * A PATCH rather than a POST because it genuinely is a partial update, and
   * the server writes only the columns on its own list — nothing sent from
   * here can reach `role` or `status`.
   */
  async pushProfile(changes: Record<string, unknown>): Promise<void> {
    if (!enabled) return
    try {
      await cloudDataService.patch('/profile', changes)
    } catch {
      // The local profile is already correct and the screen has moved on.
    }
  },

  /** Removes one row. Same contract as push: local truth already changed. */
  async remove(path: string): Promise<void> {
    if (!enabled) return
    try {
      await cloudDataService.remove(path)
    } catch {
      // A row that is already gone, or a network that is not there. Either
      // way the local cache is correct and there is nothing to tell the user.
    }
  },

  /**
   * Brings the account's cloud rows into this device's cache.
   *
   * Rows arrive owned by the server account and are stored owned by the local
   * profile, because that is the id every screen and every Dexie index in this
   * application asks by — the same relabelling `workoutData` does, for the
   * same reason. `put` rather than `add`: hydrating twice must converge, not
   * collide.
   */
  async hydrate(): Promise<{ pulled: number }> {
    if (!enabled || !profileId) return { pulled: 0 }
    const mine = profileId
    let pulled = 0

    /**
     * The id this device already uses for a given day, if it has one.
     *
     * Three of these tables hold one row per person per day, and the two
     * stores can reach that day under different ids — the server mints a new
     * one when a client id is already spoken for. Writing the server's id
     * blindly would leave the device with two rows for one day, which every
     * screen that reads by date would then get wrong. So the local row wins on
     * identity and the cloud wins on contents, which is what a cache is.
     */
    const dayIds = async (table: 'steps' | 'weights' | 'checkins') => {
      const rows = await db[table].where('userId').equals(mine).toArray()
      return new Map(rows.map((row) => [row.date, row.id]))
    }

    const pull = async <T>(path: string, into: (rows: T[]) => Promise<unknown>) => {
      try {
        const found = await cloudDataService.list<T>(path)
        if (found.length === 0) return
        await into(found)
        pulled += found.length
      } catch {
        // One domain being unreachable must not stop the others.
      }
    }

    await pull<FoodRow>('/nutrition/food', (found) =>
      db.foods.bulkPut(
        found.map((row) => ({
          id: row.id, userId: mine, date: row.date, meal: row.meal as never,
          name: row.name, portion: row.portion,
          quantity: row.quantity ?? undefined, unit: row.unit ?? undefined,
          note: row.note ?? undefined,
          kcal: row.kcal, proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g,
          source: row.source as never, createdAt: row.created_at,
        })),
      ),
    )

    await pull<WaterRow>('/nutrition/water', (found) =>
      db.water.bulkPut(
        found.map((row) => ({ id: row.id, userId: mine, date: row.date, ml: row.ml, createdAt: row.created_at })),
      ),
    )

    await pull<StepRow>('/nutrition/steps', async (found) => {
      const existing = await dayIds('steps')
      await db.steps.bulkPut(
        found.map((row) => ({
          id: existing.get(row.date) ?? row.id, userId: mine, date: row.date, steps: row.steps,
          source: row.source as never, createdAt: row.created_at,
        })),
      )
    })

    await pull<WeightRow>('/nutrition/weights', async (found) => {
      const existing = await dayIds('weights')
      await db.weights.bulkPut(
        found.map((row) => ({
          id: existing.get(row.date) ?? row.id, userId: mine, date: row.date, weightKg: row.weight_kg,
          kind: 'official' as const, note: row.note ?? undefined, createdAt: row.created_at,
        })),
      )
    })

    await pull<CheckinRow>('/nutrition/checkins', async (found) => {
      const existing = await dayIds('checkins')
      await db.checkins.bulkPut(
        found.map((row) => ({
          id: existing.get(row.date) ?? row.id, userId: mine, date: row.date,
          energy: (row.energy ?? 2) as 1 | 2 | 3 | 4,
          mood: (Number(row.feeling) || 3) as 1 | 2 | 3 | 4 | 5,
          soreness: (row.soreness ?? 'none') as never,
          note: row.note ?? undefined, createdAt: row.created_at,
        })),
      )
    })

    /*
     * Social rows keep their author's server id rather than being relabelled:
     * a post has one author and the whole group reads it, so rewriting every
     * row to say "mine" would be a lie about everybody else's. Only the
     * viewer's own rows are matched to the local profile.
     */
    await pull<UpdateRow>('/social/updates', (found) =>
      db.updates.bulkPut(
        found.map((row) => ({
          id: row.id,
          userId: row.user_id === serverSelf ? mine : row.user_id,
          kind: row.kind as never,
          text: row.text,
          meta: row.meta ? (JSON.parse(row.meta) as Record<string, string | number>) : undefined,
          dedupeKey: row.dedupe_key ?? undefined,
          createdAt: row.created_at,
        })),
      ),
    )

    await pull<NotificationRow>('/social/notifications', (found) =>
      db.notifications.bulkPut(
        found.map((row) => ({
          id: row.id, userId: mine, kind: row.kind as never, text: row.text,
          createdAt: row.created_at, readAt: row.read_at ?? undefined,
          actorId: row.actor_id ?? undefined, targetId: row.target_id ?? undefined,
          href: row.link ?? undefined,
        })),
      ),
    )

    await this.hydrateGroup()
    await this.hydrateChat()

    return { pulled }
  },

  /**
   * The other people in the group, as names and colours.
   *
   * Without this a message or a post from somebody else arrives owned by an id
   * this device has never seen, and the screen draws a blank avatar next to an
   * empty name. The roster carries display fields only — no email, no role, no
   * account status — because that is all any screen needs to render somebody
   * who is not you.
   */
  async hydrateGroup(): Promise<void> {
    if (!enabled || !profileId) return
    try {
      const people = await cloudDataService.list<RosterRow>('/roster')
      const others = people.filter((row) => row.id !== serverSelf)
      if (others.length === 0) return

      /*
       * A profile this device already knows keeps everything it had — goals,
       * units, whatever it has been told — and only takes the name and colour
       * from the roster. Somebody arriving for the first time gets a minimal
       * record that is enough to draw them, and nothing invented about their
       * body or their targets.
       */
      const known = new Map((await db.users.toArray()).map((row) => [row.id, row]))
      const rows = others.map((row) => {
        const existing = known.get(row.id)
        if (existing) {
          return {
            ...existing,
            name: row.name,
            handle: row.handle ?? existing.handle,
            avatarColor: row.avatar_color ?? existing.avatarColor,
            avatarMediaId: row.avatar_media_id ?? existing.avatarMediaId,
          }
        }
        return {
          id: row.id,
          name: row.name,
          handle: row.handle ?? row.id.slice(0, 8),
          avatarColor: row.avatar_color ?? '#3d6ea8',
          avatarMediaId: row.avatar_media_id ?? undefined,
          role: 'member' as const,
          status: 'approved' as const,
          units: 'metric' as const,
          stepGoal: 8000,
          waterGoalL: 2.5,
          workoutsPerWeekGoal: 4,
          weighInDay: 0 as const,
          workoutApps: [],
          joinedAt: row.joined_at,
          onboardedAt: row.joined_at,
        }
      })
      await db.users.bulkPut(rows as never)
    } catch {
      // The group will be drawn from what this device already knows.
    }
  },

  /**
   * The conversation.
   *
   * Pulled rather than pushed at, and pulled again whenever the socket says
   * something happened — which is what makes the realtime layer able to carry
   * an event with no content in it. Messages by the signed-in account are
   * relabelled to the local profile, exactly as workouts are, so "mine" means
   * the same thing on this screen as everywhere else.
   */
  async hydrateChat(): Promise<void> {
    if (!enabled || !profileId) return
    const mine = profileId
    try {
      const rows = await cloudDataService.list<MessageRow>('/chat/messages', { limit: 300 })
      if (rows.length === 0) return
      await db.messages.bulkPut(
        rows.map((row) => ({
          id: row.id,
          userId: row.user_id === serverSelf ? mine : row.user_id,
          text: row.text,
          createdAt: row.created_at,
          replyToId: row.reply_to_id ?? undefined,
          sharedType: (row.shared_type ?? undefined) as never,
          sharedDataId: row.shared_data_id ?? undefined,
          stickerId: row.sticker_id ?? undefined,
          pinnedAt: row.pinned_at ?? undefined,
          pinnedBy: row.pinned_by ?? undefined,
          deletedAt: row.deleted_at ?? undefined,
        })),
      )
    } catch {
      // Offline, or no backend. The conversation on this device stands.
    }
  },
}

interface FoodRow {
  id: string; date: string; meal: string; name: string; portion: string
  quantity: number | null; unit: string | null; note: string | null
  kcal: number; protein_g: number; carbs_g: number; fat_g: number
  source: string; created_at: string
}
interface WaterRow { id: string; date: string; ml: number; created_at: string }
interface StepRow { id: string; date: string; steps: number; source: string; created_at: string }
interface WeightRow { id: string; date: string; weight_kg: number; note: string | null; created_at: string }
interface CheckinRow {
  id: string; date: string; energy: number | null
  soreness: string | null; feeling: string | null; note: string | null; created_at: string
}
interface UpdateRow {
  id: string; user_id: string; kind: string; text: string
  meta: string | null; dedupe_key: string | null; created_at: string
}
interface NotificationRow {
  id: string; kind: string; text: string; link: string | null
  actor_id: string | null; target_id: string | null; read_at: string | null; created_at: string
}

interface RosterRow {
  id: string; name: string; handle: string | null
  avatar_color: string | null; avatar_media_id: string | null; joined_at: string
}
interface MessageRow {
  id: string; user_id: string; text: string; created_at: string
  reply_to_id: string | null; shared_type: string | null; shared_data_id: string | null
  sticker_id: string | null; pinned_at: string | null; pinned_by: string | null
  deleted_at: string | null
}
