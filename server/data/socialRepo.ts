/**
 * The group's shared record: posts, stories, the feed, notifications.
 *
 * Social data is the one place where "yours" and "readable by you" come apart.
 * A post is written by one person and read by the whole group, so ownership
 * governs writing, not reading: anyone approved may read the feed, and only
 * the author may edit or delete a row in it. Every mutating statement
 * therefore still carries `user_id = ?`, and the read statements deliberately
 * do not — that difference is the access rule, written down.
 *
 * Notifications are the exception in the other direction: they are addressed
 * to one person and only that person ever reads them.
 *
 * Media is referenced by id and never embedded. Nothing in this file accepts
 * a data URI or a blob, and the `media_assets` row holds a key, not bytes.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

const nowIso = () => new Date().toISOString()

/*
 * These mirror the unions in `src/models` exactly. They are written out rather
 * than imported because this file runs in a Worker and that one is the
 * browser's, but they are not a separate opinion about what a post can be: a
 * value the application creates and this list does not name is a 400 on a
 * perfectly good post, which is a worse failure than no validation at all.
 */
const POST_TYPES = [
  'text', 'photo', 'video', 'workout', 'weigh_in', 'steps', 'achievement', 'motivation', 'status',
] as const
const VISIBILITIES = ['private', 'group', 'public'] as const
const STORY_TYPES = ['text', 'photo', 'video', 'workout', 'weigh_in', 'achievement', 'motivation'] as const
const SHARED_TYPES = ['workout', 'weigh_in', 'steps', 'achievement', 'challenge'] as const
const UPDATE_KINDS = [
  'workout_completed', 'weight_logged', 'steps_logged', 'checkin',
  'achievement', 'goal_reached', 'nutrition_logged', 'challenge_completed',
] as const

export function validatePost(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    type: v.oneOf(raw.type, 'type', POST_TYPES),
    text: v.text(raw.text, 'text', 5000, { allowEmpty: true }),
    visibility: v.optionalOneOf(raw.visibility, 'visibility', VISIBILITIES) ?? 'group',
    sharedType: v.optionalOneOf(raw.sharedType, 'sharedType', SHARED_TYPES),
    sharedDataId: v.optionalId(raw.sharedDataId, 'sharedDataId'),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateComment(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    postId: v.id(raw.postId, 'postId'),
    text: v.text(raw.text, 'text', 2000),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateStory(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    type: v.oneOf(raw.type, 'type', STORY_TYPES),
    text: v.optionalText(raw.text, 'text', 1000),
    background: v.jsonBlob(raw.background, 'background', 500),
    mediaId: v.optionalId(raw.mediaId, 'mediaId'),
    expiresAt: v.timestamp(raw.expiresAt, 'expiresAt'),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateUpdate(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    kind: v.oneOf(raw.kind, 'kind', UPDATE_KINDS),
    text: v.text(raw.text, 'text', 1000),
    meta: v.jsonBlob(raw.meta, 'meta', 2000),
    dedupeKey: v.optionalText(raw.dedupeKey, 'dedupeKey', 200),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateNotification(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    kind: v.text(raw.kind, 'kind', 60),
    text: v.text(raw.text, 'text', 1000),
    href: v.optionalText(raw.href, 'href', 500),
    actorId: v.optionalId(raw.actorId, 'actorId'),
    targetId: v.optionalId(raw.targetId, 'targetId'),
    readAt: v.optionalTimestamp(raw.readAt, 'readAt'),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export function validateReaction(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    targetId: v.id(raw.targetId, 'targetId'),
    // An empty emoji means "take mine off", which is what tapping the same
    // one again does. Kept short: this is one grapheme, not a message.
    emoji: v.text(raw.emoji, 'emoji', 16, { allowEmpty: true }),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

/**
 * Removes a row only if the caller wrote it.
 *
 * Returns false rather than throwing when it is somebody else's, so the route
 * can answer 404 — telling a caller "that exists but is not yours" confirms
 * the id, and there is nothing they can do with the distinction anyway.
 */
async function removeOwn(db: D1Database, table: string, column: string, userId: string, rowId: string) {
  const existing = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND ${column} = ?`)
    .bind(rowId, userId)
    .first<{ id: string }>()
  if (!existing) return false
  await db.prepare(`DELETE FROM ${table} WHERE id = ? AND ${column} = ?`).bind(rowId, userId).run()
  return true
}

/**
 * Whether a row this one would hang off actually exists here.
 *
 * The device carries content that predates the account — seeded posts and
 * stories that live only in the local cache — and reacting to one of those
 * pushes a parent id D1 has never seen. That is a routine, expected thing for
 * a client to do, not a server fault, so it is checked and answered 404
 * rather than left to fail as a foreign-key violation and be logged as an
 * error nobody can act on.
 */
async function exists(db: D1Database, table: string, rowId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(rowId).first<{ id: string }>()
  return Boolean(row)
}

export const socialRepo = {
  /** The group feed. Readable by any approved account, hence no owner filter. */
  async listPosts(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  async savePost(db: D1Database, userId: string, input: ReturnType<typeof validatePost>) {
    await db
      .prepare(
        `INSERT INTO posts (id, user_id, type, text, visibility, shared_type, shared_data_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, visibility = excluded.visibility
         WHERE posts.user_id = ?`,
      )
      .bind(
        input.id, userId, input.type, input.text, input.visibility,
        input.sharedType, input.sharedDataId, input.createdAt, userId,
      )
      .run()
  },

  removePost: (db: D1Database, userId: string, id: string) => removeOwn(db, 'posts', 'user_id', userId, id),

  async listComments(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM comments ORDER BY created_at ASC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  /**
   * Adds a comment and moves the post's counter in the same batch.
   *
   * The count is denormalised onto the post because the feed reads it for
   * every row; keeping the two in one atomic write is what stops a comment
   * existing that the post does not know about.
   */
  async saveComment(db: D1Database, userId: string, input: ReturnType<typeof validateComment>) {
    if (!(await exists(db, 'posts', input.postId))) return false
    await db.batch([
      db
        .prepare(
          `INSERT INTO comments (id, post_id, user_id, text, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET text = excluded.text
           WHERE comments.user_id = ?`,
        )
        .bind(input.id, input.postId, userId, input.text, input.createdAt, userId),
      db
        .prepare(
          `UPDATE posts SET comment_count =
             (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id)
           WHERE id = ?`,
        )
        .bind(input.postId),
    ])
    return true
  },

  async removeComment(db: D1Database, userId: string, id: string) {
    const row = await db
      .prepare('SELECT post_id FROM comments WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<{ post_id: string }>()
    if (!row) return false
    await db.batch([
      db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').bind(id, userId),
      db
        .prepare(
          `UPDATE posts SET comment_count =
             (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id)
           WHERE id = ?`,
        )
        .bind(row.post_id),
    ])
    return true
  },

  async listPostReactions(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM post_reactions ORDER BY created_at DESC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  /**
   * One reaction per person per post. An empty emoji removes it, which is what
   * tapping the same one again means.
   */
  async togglePostReaction(db: D1Database, userId: string, input: ReturnType<typeof validateReaction>) {
    if (!(await exists(db, 'posts', input.targetId))) return false
    if (!input.emoji) {
      await db
        .prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?')
        .bind(input.targetId, userId)
        .run()
    } else {
      await db
        .prepare(
          `INSERT INTO post_reactions (id, post_id, user_id, emoji, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(post_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
        )
        .bind(input.id, input.targetId, userId, input.emoji, input.createdAt)
        .run()
    }
    await db
      .prepare(
        `UPDATE posts SET motivation =
           (SELECT COUNT(*) FROM post_reactions WHERE post_reactions.post_id = posts.id)
         WHERE id = ?`,
      )
      .bind(input.targetId)
      .run()
    return true
  },

  /** Live stories only — an expired one is nobody's business to read. */
  async listStories(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM stories WHERE expires_at > ? ORDER BY created_at DESC LIMIT ?')
      .bind(nowIso(), limit)
      .all()
    return results ?? []
  },

  async saveStory(db: D1Database, userId: string, input: ReturnType<typeof validateStory>) {
    await db
      .prepare(
        `INSERT INTO stories (id, user_id, type, text, background, media_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, background = excluded.background
         WHERE stories.user_id = ?`,
      )
      .bind(
        input.id, userId, input.type, input.text, input.background,
        input.mediaId, input.expiresAt, input.createdAt, userId,
      )
      .run()
  },

  removeStory: (db: D1Database, userId: string, id: string) => removeOwn(db, 'stories', 'user_id', userId, id),

  async listStoryViews(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM story_views ORDER BY viewed_at DESC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  /** Marks a story seen. Seen once is seen; a second look is not a second row. */
  async markStorySeen(db: D1Database, userId: string, input: { id: string; storyId: string; viewedAt: string }) {
    if (!(await exists(db, 'stories', input.storyId))) return false
    await db
      .prepare(
        `INSERT INTO story_views (id, story_id, user_id, viewed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(story_id, user_id) DO NOTHING`,
      )
      .bind(input.id, input.storyId, userId, input.viewedAt)
      .run()
    return true
  },

  async listUpdates(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM group_updates ORDER BY created_at DESC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  /**
   * Posts one announcement, at most once per real-world event.
   *
   * `dedupe_key` is UNIQUE in the schema, so this is enforced by the database
   * rather than by looking first — which is what makes it safe against two
   * tabs saving the same workout at the same moment. The Phase 30 rules fall
   * out of that: a new workout announces once because its key is new, an edit
   * announces nothing because it reuses the key, and a delete leaves the row
   * standing because nothing here removes it.
   */
  async postUpdate(db: D1Database, userId: string, input: ReturnType<typeof validateUpdate>) {
    await db
      .prepare(
        `INSERT INTO group_updates (id, user_id, kind, text, meta, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .bind(input.id, userId, input.kind, input.text, input.meta, input.dedupeKey, input.createdAt)
      .run()
    const row = input.dedupeKey
      ? await db
          .prepare('SELECT * FROM group_updates WHERE dedupe_key = ?')
          .bind(input.dedupeKey)
          .first()
      : await db.prepare('SELECT * FROM group_updates WHERE id = ?').bind(input.id).first()
    return row
  },

  async listUpdateReactions(db: D1Database, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM update_reactions ORDER BY created_at DESC LIMIT ?')
      .bind(limit)
      .all()
    return results ?? []
  },

  async toggleUpdateReaction(db: D1Database, userId: string, input: ReturnType<typeof validateReaction>) {
    if (!(await exists(db, 'group_updates', input.targetId))) return false
    if (!input.emoji) {
      await db
        .prepare('DELETE FROM update_reactions WHERE update_id = ? AND user_id = ?')
        .bind(input.targetId, userId)
        .run()
      return true
    }
    await db
      .prepare(
        `INSERT INTO update_reactions (id, update_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(update_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
      )
      .bind(input.id, input.targetId, userId, input.emoji, input.createdAt)
      .run()
    return true
  },

  /**
   * Awards somebody has earned.
   *
   * The definitions are reference data, already in D1 by migration, so only
   * the fact that a person earned one is stored here — never a copy of the
   * award itself. Earning is idempotent: the same award twice is the same
   * award, which the unique key enforces rather than the caller remembering.
   */
  async listAwards(db: D1Database, userId: string, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC LIMIT ?')
      .bind(userId, limit)
      .all()
    return results ?? []
  },

  async saveAward(
    db: D1Database,
    userId: string,
    input: { id: string; achievementKey: string; unlockedAt: string },
  ) {
    // An award key the catalogue does not have is a client out of step with
    // the server, not a row worth failing a foreign key over.
    const known = await db
      .prepare('SELECT key FROM achievement_definitions WHERE key = ?')
      .bind(input.achievementKey)
      .first<{ key: string }>()
    if (!known) return false
    await db
      .prepare(
        `INSERT INTO user_achievements (id, user_id, achievement_key, unlocked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, achievement_key) DO NOTHING`,
      )
      .bind(input.id, userId, input.achievementKey, input.unlockedAt)
      .run()
    return true
  },

  /** Withdrawn when the thing that earned it is gone — a deleted workout. */
  removeAward: (db: D1Database, userId: string, id: string) =>
    removeOwn(db, 'user_achievements', 'user_id', userId, id),

  /** Addressed to one person, and read by nobody else. */
  async listNotifications(db: D1Database, userId: string, limit: number) {
    const { results } = await db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, limit)
      .all()
    return results ?? []
  },

  async saveNotification(db: D1Database, userId: string, input: ReturnType<typeof validateNotification>) {
    await db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, text, link, actor_id, target_id, read_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET read_at = excluded.read_at
         WHERE notifications.user_id = ?`,
      )
      .bind(
        input.id, userId, input.kind, input.text, input.href,
        input.actorId, input.targetId, input.readAt, input.createdAt, userId,
      )
      .run()
  },

  async markNotificationsRead(db: D1Database, userId: string, ids: string[]) {
    if (ids.length === 0) return
    await db.batch(
      ids.map((rowId) =>
        db
          .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
          .bind(nowIso(), rowId, userId),
      ),
    )
  },

  removeNotification: (db: D1Database, userId: string, id: string) =>
    removeOwn(db, 'notifications', 'user_id', userId, id),
}
