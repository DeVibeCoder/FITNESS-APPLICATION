/**
 * Every migrated domain, behind one authenticated door.
 *
 * A table of routes rather than twenty files of near-identical boilerplate.
 * Each entry says what it needs — the method, the path, whether it takes a
 * body — and the work itself lives in the repositories, which is where the SQL
 * belongs. The dispatcher's only jobs are to find the handler and to make sure
 * `withUser` has already run, so there is no path through this file that
 * reaches a repository without an approved account behind it.
 *
 * The id in a path is a segment, never a query the caller composes, and every
 * repository binds it. The owner is always `user.id`.
 */
import { withUser, json } from './_guard'
import type { AuthenticatedUser } from '../../../server/auth/guard'
import type { D1Database } from '../../../server/fitness/repo'
import * as v from '../../../server/data/validate'
import {
  nutritionRepo,
  validateFood,
  validateWater,
  validateSteps,
  validateWeight,
  validateCheckin,
} from '../../../server/data/nutritionRepo'
import {
  socialRepo,
  validatePost,
  validateComment,
  validateStory,
  validateUpdate,
  validateNotification,
  validateReaction,
} from '../../../server/data/socialRepo'
import { chatRepo, validateMessage, CONVERSATION_ID } from '../../../server/data/chatRepo'
import { profileRepo } from '../../../server/data/profileRepo'
import { publish, type RealtimeEnv } from '../../../server/data/realtime'
import { mediaRepo, validateMedia, type R2Bucket } from '../../../server/data/mediaRepo'
import {
  trainingRepo,
  validateMeasurement,
  validateEnrollment,
  validateSetResult,
  validateChallenge,
  validateVideo,
} from '../../../server/data/trainingRepo'

interface Ctx {
  user: AuthenticatedUser
  db: D1Database
  url: URL
  /** The path segment after the resource, when there is one. */
  id: string | null
  body: () => Promise<unknown>
  /**
   * The request itself, for the one handler that reads bytes rather than JSON.
   * Everything else should use `body()`.
   */
  request: Request
  /**
   * Bindings, for the handful of handlers that tell the room something
   * changed after they have written it down, and for the media bucket.
   */
  env: RealtimeEnv & { MEDIA?: R2Bucket }
}

type Handler = (ctx: Ctx) => Promise<Response> | Response

const range = (url: URL) => ({
  from: url.searchParams.get('from'),
  to: url.searchParams.get('to'),
  limit: v.limit(url.searchParams.get('limit'), 400, 2000),
})

const lim = (url: URL, fallback = 200) => v.limit(url.searchParams.get('limit'), fallback, 2000)

const gone = () => json({ error: 'not_found', message: 'That does not exist.' }, 404)
const okay = () => json({ ok: true })

/**
 * A day-keyed table, which is four of the five nutrition resources.
 *
 * They differ only in what a row contains, so the list/save/delete shape is
 * written once and given the three functions that differ.
 */
const dayResource = (
  list: (db: D1Database, userId: string, r: ReturnType<typeof range>) => Promise<unknown[]>,
  save: (db: D1Database, userId: string, input: never) => Promise<void>,
  validate: (input: unknown) => unknown,
  remove: (db: D1Database, userId: string, id: string) => Promise<boolean>,
): Record<string, Handler> => ({
  GET: async ({ db, user, url }) => json({ rows: await list(db, user.id, range(url)) }),
  POST: async ({ db, user, body }) => {
    await save(db, user.id, validate(await body()) as never)
    return okay()
  },
  DELETE: async ({ db, user, id }) => {
    if (!id) return gone()
    return (await remove(db, user.id, v.id(id))) ? okay() : gone()
  },
})

const routes: Record<string, Record<string, Handler>> = {
  // --- Profile and roster ---------------------------------------------------
  'profile': {
    GET: async ({ db, user }) => json({ profile: await profileRepo.own(db, user.id) }),
    PATCH: async ({ db, user, body }) => json({ profile: await profileRepo.update(db, user.id, await body()) }),
  },
  'roster': {
    // `user.role` is the session's, read from the D1 row by the guard. There
    // is no field in the request that could reach this argument.
    /*
     * `rows`, like every other list route.
     *
     * This answered `{ users: ... }`, and `cloudDataService.list` reads
     * `body.rows` — so the roster silently hydrated to nothing on every device
     * since the day it was written. Nobody saw a name or an avatar for anybody
     * else, and because the failure was an empty array rather than an error,
     * it looked like "the group is empty" rather than "the group did not load".
     */
    GET: async ({ db, user }) => json({ rows: await profileRepo.roster(db, user.role === 'admin') }),
  },

  // --- Nutrition, weight, steps, check-ins ----------------------------------
  'nutrition/food': dayResource(
    nutritionRepo.listFood, nutritionRepo.saveFood, validateFood, nutritionRepo.removeFood,
  ),
  'nutrition/water': dayResource(
    nutritionRepo.listWater, nutritionRepo.saveWater, validateWater, nutritionRepo.removeWater,
  ),
  'nutrition/steps': dayResource(
    nutritionRepo.listSteps, nutritionRepo.saveSteps, validateSteps, nutritionRepo.removeSteps,
  ),
  'nutrition/weights': dayResource(
    nutritionRepo.listWeights, nutritionRepo.saveWeight, validateWeight, nutritionRepo.removeWeight,
  ),
  'nutrition/checkins': dayResource(
    nutritionRepo.listCheckins, nutritionRepo.saveCheckin, validateCheckin, nutritionRepo.removeCheckin,
  ),

  // --- Social ---------------------------------------------------------------
  'social/posts': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listPosts(db, lim(url)) }),
    POST: async ({ db, user, body }) => {
      await socialRepo.savePost(db, user.id, validatePost(await body()))
      return okay()
    },
    DELETE: async ({ db, user, id }) =>
      id && (await socialRepo.removePost(db, user.id, v.id(id))) ? okay() : gone(),
  },
  'social/comments': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listComments(db, lim(url, 500)) }),
    POST: async ({ db, user, body }) =>
      (await socialRepo.saveComment(db, user.id, validateComment(await body()))) ? okay() : gone(),
    DELETE: async ({ db, user, id }) =>
      id && (await socialRepo.removeComment(db, user.id, v.id(id))) ? okay() : gone(),
  },
  'social/post-reactions': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listPostReactions(db, lim(url, 500)) }),
    POST: async ({ db, user, body }) =>
      (await socialRepo.togglePostReaction(db, user.id, validateReaction(await body()))) ? okay() : gone(),
  },
  'social/stories': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listStories(db, lim(url)) }),
    POST: async ({ db, user, body }) => {
      await socialRepo.saveStory(db, user.id, validateStory(await body()))
      return okay()
    },
    DELETE: async ({ db, user, id }) =>
      id && (await socialRepo.removeStory(db, user.id, v.id(id))) ? okay() : gone(),
  },
  'social/story-views': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listStoryViews(db, lim(url, 500)) }),
    POST: async ({ db, user, body }) => {
      const raw = v.body(await body())
      const seen = await socialRepo.markStorySeen(db, user.id, {
        id: v.id(raw.id),
        storyId: v.id(raw.storyId, 'storyId'),
        viewedAt: v.optionalTimestamp(raw.viewedAt, 'viewedAt') ?? new Date().toISOString(),
      })
      return seen ? okay() : gone()
    },
  },
  'social/updates': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listUpdates(db, lim(url)) }),
    POST: async ({ db, user, body }) =>
      json({ row: await socialRepo.postUpdate(db, user.id, validateUpdate(await body())) }),
  },
  'social/update-reactions': {
    GET: async ({ db, url }) => json({ rows: await socialRepo.listUpdateReactions(db, lim(url, 500)) }),
    POST: async ({ db, user, body }) =>
      (await socialRepo.toggleUpdateReaction(db, user.id, validateReaction(await body()))) ? okay() : gone(),
  },
  'social/notifications': {
    GET: async ({ db, user, url }) => json({ rows: await socialRepo.listNotifications(db, user.id, lim(url)) }),
    POST: async ({ db, user, body }) => {
      await socialRepo.saveNotification(db, user.id, validateNotification(await body()))
      return okay()
    },
    PATCH: async ({ db, user, body }) => {
      const raw = v.body(await body())
      const ids = Array.isArray(raw.ids) ? raw.ids.map((one) => v.id(one, 'ids')) : []
      await socialRepo.markNotificationsRead(db, user.id, ids)
      return okay()
    },
    DELETE: async ({ db, user, id }) =>
      id && (await socialRepo.removeNotification(db, user.id, v.id(id))) ? okay() : gone(),
  },

  'social/awards': {
    GET: async ({ db, user, url }) => json({ rows: await socialRepo.listAwards(db, user.id, lim(url)) }),
    POST: async ({ db, user, body }) => {
      const raw = v.body(await body())
      const saved = await socialRepo.saveAward(db, user.id, {
        id: v.id(raw.id),
        achievementKey: v.text(raw.achievementKey, 'achievementKey', 60),
        unlockedAt: v.optionalTimestamp(raw.unlockedAt, 'unlockedAt') ?? new Date().toISOString(),
      })
      return saved ? okay() : gone()
    },
    DELETE: async ({ db, user, id }) =>
      id && (await socialRepo.removeAward(db, user.id, v.id(id))) ? okay() : gone(),
  },

  /**
   * Marking read is its own route rather than a PATCH on the collection: it
   * is the only bulk operation in the application, the client sends it from a
   * fire-and-forget path that speaks POST, and a list of ids is not a patch to
   * a list of notifications.
   */
  'social/notifications-read': {
    POST: async ({ db, user, body }) => {
      const raw = v.body(await body())
      const ids = Array.isArray(raw.ids) ? raw.ids.map((one) => v.id(one, 'ids')) : []
      await socialRepo.markNotificationsRead(db, user.id, ids)
      return okay()
    },
  },

  // --- Training: measurements, plans, sets, the week, the videos ------------
  'training/measurements': {
    GET: async ({ db, user, url }) => json({ rows: await trainingRepo.listMeasurements(db, user.id, lim(url)) }),
    POST: async ({ db, user, body }) => {
      await trainingRepo.saveMeasurement(db, user.id, validateMeasurement(await body()))
      return okay()
    },
    DELETE: async ({ db, user, id }) =>
      id && (await trainingRepo.removeMeasurement(db, user.id, v.id(id))) ? okay() : gone(),
  },

  'training/plans': {
    GET: async ({ db, url }) => {
      const planId = url.searchParams.get('planId')
      if (planId) {
        const id = v.id(planId, 'planId')
        return json({ days: await trainingRepo.planDays(db, id), exercises: await trainingRepo.planExercises(db, id) })
      }
      return json({ rows: await trainingRepo.listPlans(db, lim(url, 50)) })
    },
  },

  'training/enrollments': {
    GET: async ({ db, user }) => json({ rows: await trainingRepo.listEnrollments(db, user.id) }),
    POST: async ({ db, user, body }) =>
      (await trainingRepo.saveEnrollment(db, user.id, validateEnrollment(await body()))) ? okay() : gone(),
    DELETE: async ({ db, user, id }) =>
      id && (await trainingRepo.removeEnrollment(db, user.id, v.id(id))) ? okay() : gone(),
  },

  'training/sets': {
    GET: async ({ db, user, url }) => json({ rows: await trainingRepo.listSetResults(db, user.id, lim(url, 1000)) }),
    POST: async ({ db, user, body }) =>
      (await trainingRepo.saveSetResult(db, user.id, validateSetResult(await body()))) ? okay() : gone(),
  },

  'training/challenges': {
    GET: async ({ db, url }) => json({ rows: await trainingRepo.listChallenges(db, lim(url, 60)) }),
    // Creating the week is idempotent, so this reads as much as it writes:
    // whoever opens the app first on a Sunday makes it, everybody else finds it.
    POST: async ({ db, body }) =>
      json({ row: await trainingRepo.ensureChallenge(db, validateChallenge(await body())) }),
  },

  'training/participation': {
    GET: async ({ db, url }) => json({ rows: await trainingRepo.listParticipants(db, lim(url, 500)) }),
    POST: async ({ db, user, body }) => {
      const raw = v.body(await body())
      const done = await trainingRepo.setParticipation(db, user.id, {
        id: v.id(raw.id),
        challengeId: v.id(raw.challengeId, 'challengeId'),
        takingPart: v.boolean(raw.takingPart, 'takingPart'),
        joinedAt: v.optionalTimestamp(raw.joinedAt, 'joinedAt') ?? new Date().toISOString(),
        leftAt: v.optionalTimestamp(raw.leftAt, 'leftAt'),
      })
      return done ? okay() : gone()
    },
  },

  'training/videos': {
    GET: async ({ db, url }) => json({ rows: await trainingRepo.listVideos(db, lim(url, 100)) }),
    POST: async ({ db, user, body }) => {
      await trainingRepo.saveVideo(db, user.id, validateVideo(await body()))
      return okay()
    },
    DELETE: async ({ db, user, id }) =>
      id && (await trainingRepo.removeVideo(db, user.id, v.id(id))) ? okay() : gone(),
  },

  // --- Chat -----------------------------------------------------------------
  'chat/messages': {
    GET: async ({ db, user, url }) => {
      await chatRepo.ensureMember(db, user.id)
      return json({ rows: await chatRepo.listMessages(db, lim(url, 300)) })
    },
    POST: async ({ db, user, body, env }) => {
      await chatRepo.ensureMember(db, user.id)
      const message = validateMessage(await body())
      await chatRepo.saveMessage(db, user.id, message)
      // Written first, announced second. The message is saved whether or not
      // anybody was listening.
      await publish(env, CONVERSATION_ID, { kind: 'message', id: message.id, actorId: user.id })
      return okay()
    },
    DELETE: async ({ db, user, id, env }) => {
      if (!id || !(await chatRepo.deleteMessage(db, user.id, v.id(id)))) return gone()
      await publish(env, CONVERSATION_ID, { kind: 'deleted', id: v.id(id), actorId: user.id })
      return okay()
    },
  },
  'chat/pins': {
    POST: async ({ db, user, body }) => {
      const raw = v.body(await body())
      const done = await chatRepo.setPinned(db, user.id, v.id(raw.messageId, 'messageId'), v.boolean(raw.pinned, 'pinned'))
      return done ? okay() : gone()
    },
  },
  'chat/reactions': {
    GET: async ({ db, url }) => json({ rows: await chatRepo.listReactions(db, lim(url, 500)) }),
    POST: async ({ db, user, body, env }) => {
      const raw = v.body(await body())
      const reacted = await chatRepo.toggleReaction(db, user.id, {
        id: v.id(raw.id),
        messageId: v.id(raw.messageId, 'messageId'),
        emoji: v.text(raw.emoji, 'emoji', 16, { allowEmpty: true }),
        createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? new Date().toISOString(),
      })
      if (!reacted) return gone()
      await publish(env, CONVERSATION_ID, { kind: 'reaction', id: v.id(raw.messageId, 'messageId'), actorId: user.id })
      return okay()
    },
  },
  'chat/members': {
    GET: async ({ db, user }) => {
      await chatRepo.ensureMember(db, user.id)
      return json({ rows: await chatRepo.members(db, user.role === 'admin') })
    },
  },

  // --- Media ----------------------------------------------------------------
  'media': {
    GET: async ({ db, url, user, id, env, request }) => {
      /*
       * Two shapes on one resource, split by whether an id is present:
       *
       *   GET /media?ids=a,b   metadata for the cards that are about to draw
       *   GET /media/<id>      the bytes themselves, out of R2
       *
       * The second is the only route in the application that answers with
       * something other than JSON, and the only one that touches the bucket.
       */
      if (id) return mediaRepo.serve(db, env.MEDIA, user, v.id(id), request)
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map((one) => v.id(one, 'ids'))
      return json({ rows: await mediaRepo.byIds(db, ids) })
    },
    POST: async ({ db, user, body }) => {
      await mediaRepo.register(db, user.id, validateMedia(await body()))
      return okay()
    },
  },
  'media/upload': {
    /*
     * Bytes in, a key out.
     *
     * The browser uploads through this Worker rather than straight to R2 with
     * a presigned URL. Presigning needs S3 credentials — an R2 access key and
     * secret, stored as deployment secrets and handed to the client as a
     * signed URL — which is a second credential to manage and a second way in.
     * The session cookie already says who this is; this route uses it and puts
     * the object down itself.
     */
    POST: async ({ db, user, env, request }) => mediaRepo.upload(db, env.MEDIA, user.id, request),
  },
}

const handle = (context: {
  request: Request
  env: { DB?: unknown } & RealtimeEnv & { MEDIA?: R2Bucket }
  params: { route?: string | string[] }
}) =>
  withUser(context, async (user, db) => {
    const segments = Array.isArray(context.params.route)
      ? context.params.route
      : (context.params.route ?? '').split('/').filter(Boolean)

    // A route is one or two segments; anything after that is an id.
    const twoPart = segments.slice(0, 2).join('/')
    const onePart = segments[0] ?? ''
    const table = routes[twoPart] ? twoPart : routes[onePart] ? onePart : null
    if (!table) return gone()

    const used = table.split('/').length
    const handler = routes[table][context.request.method]
    if (!handler) {
      return json({ error: 'method_not_allowed', message: 'That is not something you can do here.' }, 405)
    }

    return handler({
      user,
      db,
      url: new URL(context.request.url),
      id: segments[used] ?? null,
      body: () => context.request.json(),
      request: context.request,
      env: context.env,
    })
  })

export const onRequestGet = handle
export const onRequestPost = handle
export const onRequestPatch = handle
export const onRequestDelete = handle
