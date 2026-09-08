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
import type { ID, User } from '@/models'
import { cloudDataService, CloudDataError } from './cloudDataService'
import { cloudWorkoutService } from './cloudWorkoutService'

let enabled = false
/** The profile this device knows the signed-in person by. */
let profileId: ID | null = null
/**
 * The signed-in account's server id, so hydrate can tell the viewer's own
 * social rows from everybody else's.
 */
let serverSelf: ID | null = null

/**
 * A full pull in flight, and when the last one finished.
 *
 * `hydrate` is around twenty requests now that it actually covers the
 * application, so it needs two guards that a single boot-time call never did.
 * Overlapping runs are joined rather than started twice — a tab regaining
 * focus while a pull is already going would otherwise double every request —
 * and a minimum gap stops a burst of focus and visibility events, which fire
 * together on mobile, from meaning three pulls in a second.
 */
let syncing: Promise<void> | null = null
let lastSyncAt = 0
const MIN_SYNC_GAP_MS = 20_000

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
    // A new session must not inherit the last one's throttle.
    lastSyncAt = 0
  },

  enabled(): boolean {
    return enabled
  },

  /**
   * Bring this device up to date. The one call the application makes.
   *
   * Hydration used to happen exactly once, when a session was resolved, which
   * meant a device only ever saw the world as it stood the moment somebody
   * signed in. Another person's post, made a minute later, did not exist here
   * until the app was closed and reopened — and because the chat *was* wired
   * to its realtime signal, chat was the one thing that appeared to work,
   * which is a good way to conclude the backend is fine and the rest is local.
   *
   * `force` is for the moments where being current matters more than being
   * frugal: signing in, and coming back to the tab.
   */
  async sync(force = false): Promise<void> {
    if (!enabled || !profileId) return
    // Already running. Join it rather than starting a second one.
    if (syncing) return syncing
    if (!force && Date.now() - lastSyncAt < MIN_SYNC_GAP_MS) return

    syncing = (async () => {
      try {
        await this.hydrate()
      } catch {
        // hydrate swallows per-domain failures already; this is the belt for
        // anything thrown around them. A failed refresh is not a reason to
        // break the screen the person is looking at.
      } finally {
        lastSyncAt = Date.now()
        syncing = null
      }
    })()
    return syncing
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
  /**
   * Brings the account's cloud rows into this device's cache. Everything, now.
   *
   * This used to pull seven paths — meals, water, steps, weigh-ins, check-ins,
   * the group feed and notifications — while the server had a GET for
   * twenty-two. Everything else existed in D1, was written there correctly by
   * the push path, and was never read back: posts, comments, reactions,
   * stories, story views, awards, measurements, enrollments, set results,
   * challenges, participation, motivation videos, chat reactions, media and
   * workouts. So a second device signed into the same account, or a second
   * person signed into the group, saw an empty application and concluded the
   * app was local. It was not local; it was half-hydrated, which looks
   * identical from a screen.
   *
   * Two ownership rules run through all of it, and they are not the same rule:
   *
   * **Private rows** — meals, weigh-ins, measurements, enrollments, sets,
   * awards, notifications — are returned by the server for the caller alone,
   * so they are stored owned by this device's local profile. There is nobody
   * else in the response to mislabel.
   *
   * **Group rows** — posts, comments, reactions, stories, views, updates,
   * messages, participation — carry an author, and everybody's rows come back.
   * Only the viewer's own are relabelled to the local profile; everyone else
   * keeps their server id, which is what the roster gives a name and a colour
   * to. Rewriting all of them to "mine" would be a lie about the whole group.
   *
   * `put` rather than `add` throughout: hydrating twice converges rather than
   * colliding, which is what makes this safe to run on a timer.
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

    /** Whose row this is, in the ids the screens ask by. */
    const owner = (serverUserId: string) => (serverUserId === serverSelf ? mine : serverUserId)

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

    // --- The caller's own logs ---------------------------------------------

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

    await pull<MeasurementRow>('/training/measurements', (found) =>
      db.measurements.bulkPut(
        found.map((row) => ({
          id: row.id, userId: mine, date: row.date,
          waistCm: row.waist_cm ?? undefined, chestCm: row.chest_cm ?? undefined,
          hipsCm: row.hips_cm ?? undefined, armCm: row.arm_cm ?? undefined,
          thighCm: row.thigh_cm ?? undefined, bodyFatPct: row.body_fat_pct ?? undefined,
          note: row.note ?? undefined, createdAt: row.created_at,
        })),
      ),
    )

    await pull<AwardRow>('/social/awards', (found) =>
      db.achievements.bulkPut(
        found.map((row) => ({
          id: row.id, userId: mine, achievementKey: row.achievement_key, unlockedAt: row.unlocked_at,
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

    await pull<EnrollmentRow>('/training/enrollments', (found) =>
      db.enrollments.bulkPut(
        found.map((row) => ({
          id: row.id, userId: mine, planId: row.plan_id,
          startDate: row.start_date, active: Boolean(row.active),
        })),
      ),
    )

    await pull<SetResultRow>('/training/sets', (found) =>
      db.setResults.bulkPut(
        found.map((row) => ({
          id: row.id, sessionId: row.session_id, workoutExerciseId: row.plan_exercise_id,
          setIndex: row.set_index,
          reps: row.reps ?? undefined, durationSec: row.duration_sec ?? undefined,
          weightKg: row.weight_kg ?? undefined,
          completed: Boolean(row.completed), skipped: row.skipped ? true : undefined,
          completedAt: row.completed_at ?? undefined,
        })),
      ),
    )

    // --- Training the whole group shares -----------------------------------

    await pull<ChallengeRow>('/training/challenges', (found) =>
      db.challenges.bulkPut(
        found.map((row) => ({
          id: row.id, weekStart: row.week_start, title: row.title, blurb: row.blurb,
          metric: row.metric as never, target: row.target, perMember: Boolean(row.per_member),
          unit: row.unit, icon: row.icon, createdAt: row.created_at,
        })),
      ),
    )

    await pull<ParticipantRow>('/training/participation', (found) =>
      db.challengeParticipants.bulkPut(
        found.map((row) => ({
          id: row.id, challengeId: row.challenge_id, userId: owner(row.user_id),
          joinedAt: row.joined_at, leftAt: row.left_at ?? undefined,
        })),
      ),
    )

    await pull<VideoRow>('/training/videos', (found) =>
      db.videos.bulkPut(
        found.map((row) => ({
          id: row.id, title: row.title, url: row.url, provider: row.provider as never,
          quote: row.note ?? undefined, thumbnailUrl: row.thumbnail_url ?? undefined,
          durationSec: row.duration_sec ?? undefined,
          addedBy: owner(row.added_by), addedAt: row.created_at,
          isActive: Boolean(row.is_active), rotationOrder: row.rotation_order ?? undefined,
        })),
      ),
    )

    // --- The social layer ---------------------------------------------------

    /*
     * Reactions are pulled before posts so the counter can be recomputed from
     * them. `posts.reaction_count` is not a column — the server keeps
     * `comment_count` and nothing else — so a post's reaction total is derived
     * here from the rows that actually exist, which is the only number that
     * cannot drift from them.
     */
    const reactionsByPost = new Map<string, number>()
    await pull<PostReactionRow>('/social/post-reactions', async (found) => {
      for (const row of found) {
        reactionsByPost.set(row.post_id, (reactionsByPost.get(row.post_id) ?? 0) + 1)
      }
      await db.postReactions.bulkPut(
        found.map((row) => ({
          id: row.id, postId: row.post_id, userId: owner(row.user_id),
          emoji: row.emoji, createdAt: row.created_at,
        })),
      )
    })

    await pull<PostRow>('/social/posts', async (found) => {
      /*
       * A post's media stays on the device that made it until object storage
       * exists — see server/data/mediaRepo. So the local row's `mediaIds` are
       * preserved rather than blanked: hydrating must not strip a picture off
       * a post on the very device that still has it.
       */
      const local = new Map(
        (await db.posts.bulkGet(found.map((row) => row.id)))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => [row.id, row]),
      )
      await db.posts.bulkPut(
        found.map((row) => ({
          id: row.id, userId: owner(row.user_id), type: row.type as never,
          text: row.text, createdAt: row.created_at,
          visibility: (row.visibility ?? 'group') as never,
          mediaIds: local.get(row.id)?.mediaIds ?? [],
          sharedType: (row.shared_type ?? undefined) as never,
          sharedDataId: row.shared_data_id ?? undefined,
          /*
           * `motivation` is the server's own reaction counter, kept in step by
           * the same statement that writes a reaction. Counting the rows we
           * happened to pull is the fallback, for a post whose reactions came
           * back in a page this pull did not reach.
           */
          reactionCount: row.motivation ?? reactionsByPost.get(row.id) ?? local.get(row.id)?.reactionCount ?? 0,
          commentCount: row.comment_count ?? 0,
        })),
      )
    })

    await pull<CommentRow>('/social/comments', (found) =>
      db.comments.bulkPut(
        found.map((row) => ({
          id: row.id, postId: row.post_id, userId: owner(row.user_id),
          text: row.text, createdAt: row.created_at,
        })),
      ),
    )

    await pull<StoryRow>('/social/stories', async (found) => {
      const local = new Map(
        (await db.stories.bulkGet(found.map((row) => row.id)))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => [row.id, row]),
      )
      await db.stories.bulkPut(
        found.map((row) => ({
          id: row.id, userId: owner(row.user_id), type: row.type as never,
          text: row.text ?? undefined,
          // Same reasoning as a post's media: kept, never blanked by a pull.
          mediaId: local.get(row.id)?.mediaId,
          background: (row.background ?? undefined) as never,
          createdAt: row.created_at, expiresAt: row.expires_at,
          sharedType: (row.shared_type ?? undefined) as never,
          sharedDataId: row.shared_data_id ?? undefined,
        })),
      )
    })

    await pull<StoryViewRow>('/social/story-views', (found) =>
      db.storyViews.bulkPut(
        found.map((row) => ({
          id: row.id, storyId: row.story_id, userId: owner(row.user_id), viewedAt: row.viewed_at,
        })),
      ),
    )

    await pull<UpdateRow>('/social/updates', (found) =>
      db.updates.bulkPut(
        found.map((row) => ({
          id: row.id,
          userId: owner(row.user_id),
          kind: row.kind as never,
          text: row.text,
          meta: row.meta ? (JSON.parse(row.meta) as Record<string, string | number>) : undefined,
          dedupeKey: row.dedupe_key ?? undefined,
          createdAt: row.created_at,
        })),
      ),
    )

    await pull<UpdateReactionRow>('/social/update-reactions', (found) =>
      db.reactions.bulkPut(
        found.map((row) => ({
          id: row.id, updateId: row.update_id, userId: owner(row.user_id),
          emoji: row.emoji, createdAt: row.created_at,
        })),
      ),
    )

    await this.hydrateProfile()
    await this.hydrateWorkouts()
    await this.hydrateGroup()
    await this.hydrateChat()

    return { pulled }
  },

  /**
   * The account's workouts, into the store every screen reads.
   *
   * `workoutData` already fetched these on demand for the history screen, and
   * that was mistaken for having them: Home, Progress, Awards and the weekly
   * challenge all read `db.sessions` through a live query, so on a second
   * device they counted zero workouts while D1 held a year of them. Fetching
   * for one screen is not the same as caching for the app.
   *
   * The exercises inside a session are deliberately not pulled here. They are
   * one request per workout, nothing on a summary screen reads them, and
   * `workoutData.exercisesFor` already fetches the one being opened.
   */
  /**
   * The account's own profile, as the server holds it.
   *
   * This is what makes a second device show the person's real height, goal and
   * weigh-in day instead of the defaults a new local profile is born with. It
   * is also the read half of a bug that used to run the other way: signing in
   * somewhere new created a placeholder profile and *pushed it up*, so a second
   * device quietly overwrote the real one in D1 with 175cm and 80kg. The server
   * is the record; this reads it.
   *
   * Only columns the server actually has a value for are applied. A null in
   * D1 means "never set", and writing that over a local value would be the
   * same overwrite in the other direction.
   */
  async hydrateProfile(): Promise<void> {
    if (!enabled || !profileId) return
    const target = profileId
    try {
      const profile = await this.ownProfile()
      if (!profile) return
      await db.users.update(target, profile)
    } catch {
      // The local profile stands.
    }
  },

  /**
   * The server's row for the signed-in account, in the application's shape.
   *
   * Returns null when there is nothing to read. Used both by the refresh above
   * and, more importantly, when a device first links an account — where it is
   * the difference between adopting the person's real profile and inventing a
   * new one over the top of it.
   */
  async ownProfile(): Promise<Partial<User> | null> {
    try {
      const body = await cloudDataService.get<{ profile: ProfileRow | null }>('/profile')
      return body.profile ? fromProfileRow(body.profile) : null
    } catch {
      return null
    }
  },

  async hydrateWorkouts(): Promise<void> {
    if (!enabled || !profileId) return
    const mine = profileId
    try {
      const sessions = await cloudWorkoutService.list(200)
      if (sessions.length === 0) return
      await db.sessions.bulkPut(sessions.map((session) => ({ ...session, userId: mine })))
    } catch {
      // Offline, or no backend. Whatever is cached stands.
    }
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
      const existing = new Map(
        (await db.users.bulkGet(others.map((row) => row.id)))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => [row.id, row]),
      )
      await db.users.bulkPut(
        others.map((row) => {
          const current = existing.get(row.id)
          return {
            ...(current ?? PLACEHOLDER_PROFILE),
            id: row.id,
            name: row.name,
            handle: row.handle ?? current?.handle ?? row.id.slice(-6),
            avatarColor: row.avatar_color ?? current?.avatarColor ?? '#c2410c',
            avatarMediaId: row.avatar_media_id ?? current?.avatarMediaId,
            joinedAt: row.joined_at,
          }
        }),
      )
    } catch {
      // The group's names are a nicety; the app works without them.
    }
  },

  /**
   * The conversation, and the reactions on it.
   *
   * Messages carry no content over the socket — the realtime layer only says
   * something happened — which is what makes the realtime layer able to carry
   * an event with no content in it. Messages by the signed-in account are
   * relabelled to the local profile, exactly as workouts are, so "mine" means
   * the same thing on this screen as everywhere else.
   */
  async hydrateChat(): Promise<void> {
    if (!enabled || !profileId) return
    const mine = profileId
    const owner = (serverUserId: string) => (serverUserId === serverSelf ? mine : serverUserId)
    try {
      const rows = await cloudDataService.list<MessageRow>('/chat/messages', { limit: 300 })
      if (rows.length > 0) {
        await db.messages.bulkPut(
          rows.map((row) => ({
            id: row.id,
            userId: owner(row.user_id),
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
      }
    } catch {
      // Offline, or no backend. The conversation on this device stands.
    }

    try {
      const reactions = await cloudDataService.list<ChatReactionRow>('/chat/reactions', { limit: 500 })
      if (reactions.length === 0) return
      await db.chatReactions.bulkPut(
        reactions.map((row) => ({
          id: row.id, messageId: row.message_id, userId: owner(row.user_id),
          emoji: row.emoji, createdAt: row.created_at,
        })),
      )
    } catch {
      // As above.
    }
  },
}

/**
 * The shape a roster row is grown into when this device has never seen the
 * person before.
 *
 * A `User` needs a body and a set of goals it has no business inventing for
 * somebody else, so these are placeholders that no screen reads for anybody
 * but the signed-in profile — the roster exists to draw a name and an avatar
 * beside a message, and nothing on those screens asks a stranger's height.
 */
const PLACEHOLDER_PROFILE = {
  name: '', handle: '', avatarColor: '#c2410c',
  birthDate: '1990-01-01', sex: 'male' as const,
  heightCm: 175, startWeightKg: 80, targetWeightKg: 75,
  goal: 'general_fitness' as const, activityLevel: 'moderate' as const,
  stepGoal: 8000, waterGoalL: 2.5, workoutsPerWeekGoal: 4,
  weighInDay: 0 as const, workoutApps: [], units: 'metric' as const,
  joinedAt: new Date().toISOString(),
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

interface MeasurementRow {
  id: string; date: string; waist_cm: number | null; chest_cm: number | null
  hips_cm: number | null; arm_cm: number | null; thigh_cm: number | null
  body_fat_pct: number | null; note: string | null; created_at: string
}
interface AwardRow { id: string; achievement_key: string; unlocked_at: string }
interface EnrollmentRow {
  id: string; plan_id: string; start_date: string; active: number
}
interface SetResultRow {
  id: string; session_id: string; plan_exercise_id: string; set_index: number
  reps: number | null; duration_sec: number | null; weight_kg: number | null
  completed: number; skipped: number | null; completed_at: string | null
}
interface ChallengeRow {
  id: string; week_start: string; title: string; blurb: string; metric: string
  target: number; per_member: number; unit: string; icon: string; created_at: string
}
interface ParticipantRow {
  id: string; challenge_id: string; user_id: string
  joined_at: string; left_at: string | null
}
interface VideoRow {
  id: string; title: string; url: string; provider: string; note: string | null
  thumbnail_url: string | null; duration_sec: number | null; added_by: string
  is_active: number; rotation_order: number | null; created_at: string
}
interface PostRow {
  id: string; user_id: string; type: string; text: string; visibility: string | null
  shared_type: string | null; shared_data_id: string | null
  comment_count: number | null; motivation: number | null; created_at: string
}
interface PostReactionRow {
  id: string; post_id: string; user_id: string; emoji: string; created_at: string
}
interface CommentRow {
  id: string; post_id: string; user_id: string; text: string; created_at: string
}
interface StoryRow {
  id: string; user_id: string; type: string; text: string | null
  background: string | null; media_id: string | null
  shared_type: string | null; shared_data_id: string | null
  expires_at: string; created_at: string
}
interface StoryViewRow { id: string; story_id: string; user_id: string; viewed_at: string }
interface UpdateReactionRow {
  id: string; update_id: string; user_id: string; emoji: string; created_at: string
}
interface ChatReactionRow {
  id: string; message_id: string; user_id: string; emoji: string; created_at: string
}

interface ProfileRow {
  name: string | null; handle: string | null; avatar_color: string | null
  avatar_media_id: string | null; birth_date: string | null; sex: string | null
  height_cm: number | null; start_weight_kg: number | null; target_weight_kg: number | null
  goal: string | null; activity_level: string | null; calorie_target_override: number | null
  step_goal: number | null; water_goal_l: number | null; workouts_per_week_goal: number | null
  weigh_in_day: number | null; units: string | null; onboarded_at: string | null
}

/**
 * A server profile row, as the fields the application would set.
 *
 * Nulls are dropped rather than mapped to undefined, because these values are
 * fed to `db.users.update`, and a key present with `undefined` clears the
 * column it names. "The server has never been told" and "the server says
 * empty" have to mean different things here, and only one of them should
 * touch what is already on the device.
 */
function fromProfileRow(row: ProfileRow): Partial<User> {
  const out: Record<string, unknown> = {}
  const set = (key: keyof User, value: unknown) => {
    if (value !== null && value !== undefined) out[key] = value
  }
  set('name', row.name)
  set('handle', row.handle)
  set('avatarColor', row.avatar_color)
  set('avatarMediaId', row.avatar_media_id)
  set('birthDate', row.birth_date)
  set('sex', row.sex)
  set('heightCm', row.height_cm)
  set('startWeightKg', row.start_weight_kg)
  set('targetWeightKg', row.target_weight_kg)
  set('goal', row.goal)
  set('activityLevel', row.activity_level)
  set('calorieTargetOverride', row.calorie_target_override)
  set('stepGoal', row.step_goal)
  set('waterGoalL', row.water_goal_l)
  set('workoutsPerWeekGoal', row.workouts_per_week_goal)
  set('weighInDay', row.weigh_in_day)
  set('units', row.units)
  set('onboardedAt', row.onboarded_at)
  return out as Partial<User>
}
