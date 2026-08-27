import { db, DataError } from '@/lib/db'
import { now, uid } from '@/lib/id'
import type {
  Comment,
  DateKey,
  ID,
  MediaAsset,
  Post,
  PostType,
  SharedType,
  User,
  Visibility,
} from '@/models'
import { chatService } from './chatService'
import { mediaService } from './mediaService'
import type { MediaInput } from './mediaService'
import { assertOwner, assertOwnerOf } from './ownership'

/**
 * The group feed.
 *
 * Reads, the visibility rule, and the shapes the feed renders — plus the two
 * things people actually do to a post: react to it and comment on it. Both go
 * through the same ownership guard the chat uses, because a server will apply
 * exactly that rule and it should live in one place.
 *
 * Comments are one level deep on purpose. Threads are not a feature here; this
 * is three people talking, not a forum.
 */

export interface FeedPost extends Post {
  author: User
  media: MediaAsset[]
}

/**
 * The records a post can carry.
 *
 * A subset of `SharedType` on purpose: every one of these has a matching
 * `PostType`, so what the card announces and what it points at are the same
 * fact rather than two that can drift apart.
 */
export const POST_SHARES = ['workout', 'weigh_in', 'steps', 'achievement'] as const
export type PostShare = (typeof POST_SHARES)[number]

/** A picture, as the composer hands it over. See `MediaInput`. */
export type PostMediaInput = MediaInput

export interface NewPost {
  userId: ID
  text: string
  visibility?: Visibility
  media?: PostMediaInput
  sharedType?: PostShare
  sharedDataId?: ID
}

/**
 * What a given viewer is allowed to see.
 *
 * Everyone here is in the same private group, so `group` and `public` are both
 * visible; `private` is the author's alone. Written as an explicit predicate
 * because a server will need exactly this rule, and it should be one function
 * rather than a condition spread across screens.
 */
export function canView(post: Pick<Post, 'userId' | 'visibility'>, viewerId: ID): boolean {
  if (post.visibility === 'private') return post.userId === viewerId
  return true
}

export const postService = {
  /** Newest first, filtered to what this viewer may see. */
  async feed(viewerId: ID, limit = 30): Promise<FeedPost[]> {
    const rows = await db.posts.orderBy('createdAt').reverse().limit(limit * 2).toArray()
    const visible = rows.filter((post) => canView(post, viewerId)).slice(0, limit)
    return this.hydrate(visible)
  },

  /** One person's posts, for their own area. */
  async byUser(userId: ID, viewerId: ID, limit = 30): Promise<FeedPost[]> {
    const rows = await db.posts.where('userId').equals(userId).reverse().sortBy('createdAt')
    const visible = rows.filter((post) => canView(post, viewerId)).slice(0, limit)
    return this.hydrate(visible)
  },

  count(): Promise<number> {
    return db.posts.count()
  },

  // --- Writing -------------------------------------------------------------

  /**
   * Writes a post.
   *
   * Media is registered through `mediaService` rather than written here, so the
   * "reference, never bytes" rule has exactly one enforcement point. If the
   * post itself fails to land the asset row is removed again — an orphaned
   * reference to a post that does not exist is worse than no reference.
   *
   * `type` is derived rather than asked for: what a post *is* follows from what
   * it carries, and a caller that could disagree with its own contents is a
   * caller that eventually will.
   */
  async create(input: NewPost): Promise<Post> {
    // You post as yourself. The same rule a server would apply.
    assertOwner(input.userId)

    const text = input.text.trim()
    const share = input.sharedType && input.sharedDataId ? input.sharedType : undefined
    if (!text && !input.media && !share) {
      throw new DataError('A post needs a few words, a photo or something to share.')
    }

    const asset = input.media ? await mediaService.register(input.media) : undefined
    const mediaIds = asset ? [asset.id] : []
    const post: Post = {
      id: uid('p'),
      userId: input.userId,
      type: postTypeFor({ mediaIds, sharedType: share }),
      text,
      createdAt: now(),
      visibility: input.visibility ?? DEFAULT_VISIBILITY,
      mediaIds,
      sharedType: share,
      sharedDataId: share ? input.sharedDataId : undefined,
      reactionCount: 0,
      commentCount: 0,
    }

    try {
      await db.posts.add(post)
    } catch (error) {
      // Never leave a reference behind pointing at a post that never landed.
      if (asset) await db.media.delete(asset.id)
      throw error
    }
    return post
  },

  /**
   * Edits your own post.
   *
   * `media: null` removes the picture, a value replaces it, and leaving the key
   * out leaves it alone — three states the composer genuinely has. Whatever the
   * post stops referencing is released afterwards, so removing a photo does not
   * leave its row behind forever.
   */
  async update(
    postId: ID,
    changes: { text?: string; visibility?: Visibility; media?: PostMediaInput | null },
  ): Promise<void> {
    const post = await db.posts.get(postId)
    // Only the author. Editing someone else's words is not an oversight for
    // the UI to catch — it is the thing this guard exists for.
    assertOwnerOf(post)
    if (!post) return

    const text = changes.text === undefined ? post.text : changes.text.trim()
    const keepsMedia =
      changes.media === undefined ? post.mediaIds.length > 0 : Boolean(changes.media)
    if (!text && !keepsMedia && !post.sharedType) {
      throw new DataError('A post needs a few words, a photo or something to share.')
    }

    const patch: Partial<Post> = { text, updatedAt: now() }
    if (changes.visibility) patch.visibility = changes.visibility

    let released: ID[] = []
    if (changes.media !== undefined) {
      released = post.mediaIds
      const asset = changes.media ? await mediaService.register(changes.media) : undefined
      patch.mediaIds = asset ? [asset.id] : []

      /*
       * Only the two picture-derived kinds follow the picture. A post that
       * announced a workout, a weigh-in or a piece of motivation keeps saying
       * so — removing its photo changes what it shows, not what it was.
       */
      const derived = postTypeFor({ mediaIds: patch.mediaIds, sharedType: post.sharedType })
      patch.type = post.type === 'photo' || post.type === 'status' ? derived : post.type
    }

    await db.posts.update(postId, patch)
    if (released.length > 0) await mediaService.releaseUnused(released, { postId })
  },

  /**
   * Deletes your own post, and everything that only existed because of it.
   *
   * Reactions and comments go with it rather than being left pointing at
   * nothing — a comment on a post that no longer exists cannot be read, cannot
   * be deleted by its author, and still counts in every query that scans the
   * table.
   */
  async remove(postId: ID): Promise<void> {
    const post = await db.posts.get(postId)
    assertOwnerOf(post)
    if (!post) return

    const [reactionKeys, commentKeys] = await Promise.all([
      db.postReactions.where('postId').equals(postId).primaryKeys(),
      db.comments.where('postId').equals(postId).primaryKeys(),
    ])
    await db.postReactions.bulkDelete(reactionKeys)
    await db.comments.bulkDelete(commentKeys)
    await db.posts.delete(postId)
    await mediaService.releaseUnused(post.mediaIds, { postId })
  },

  // --- Sharing a record ----------------------------------------------------

  /**
   * What this person actually has to attach, in the same terms the chat's
   * share menu uses — deliberately the same call, so the two menus can never
   * disagree about what exists. Only the kinds a post can *be* are offered;
   * the weekly challenge belongs to the group rather than to one person's
   * progress.
   */
  async shareOptions(userId: ID, date: DateKey): Promise<Set<PostShare>> {
    const available = await chatService.shareable(userId, date)
    return new Set(POST_SHARES.filter((kind) => available.has(kind)))
  },

  /**
   * The id of the record a share points at, resolved at post time. The post
   * stores the id and never a copy, so correcting the workout later corrects
   * the card that announced it.
   */
  async shareTarget(userId: ID, kind: PostShare, date: DateKey): Promise<ID | undefined> {
    switch (kind) {
      case 'workout': {
        const sessions = await db.sessions
          .where('userId')
          .equals(userId)
          .filter((session) => session.status === 'completed')
          .sortBy('date')
        return sessions.at(-1)?.id
      }
      case 'weigh_in': {
        const weights = await db.weights.where('userId').equals(userId).sortBy('date')
        return weights.filter((entry) => entry.kind === 'official').at(-1)?.id
      }
      case 'steps':
        return (await db.steps.where('[userId+date]').equals([userId, date]).first())?.id
      case 'achievement': {
        const unlocked = await db.achievements.where('userId').equals(userId).toArray()
        return unlocked.sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))[0]?.achievementKey
      }
    }
  },

  // --- Reactions -----------------------------------------------------------

  /**
   * One emoji per person per post. Tapping the same one again removes it;
   * tapping a different one replaces it. Identical to how chat and the updates
   * feed already behave, so the gesture means the same thing everywhere.
   */
  async toggleReaction(postId: ID, userId: ID, emoji: string): Promise<void> {
    // You react as yourself; nobody reacts on your behalf.
    assertOwner(userId)
    const existing = await db.postReactions
      .where('[postId+userId]')
      .equals([postId, userId])
      .first()

    if (existing?.emoji === emoji) {
      await db.postReactions.delete(existing.id)
    } else if (existing) {
      await db.postReactions.update(existing.id, { emoji, createdAt: now() })
    } else {
      await db.postReactions.add({ id: uid('pr'), postId, userId, emoji, createdAt: now() })
    }
    await this.recount(postId)
  },

  async reactionsFor(postId: ID) {
    return db.postReactions.where('postId').equals(postId).toArray()
  },

  // --- Comments ------------------------------------------------------------

  /** Oldest first: a conversation reads downward. */
  async commentsFor(postId: ID): Promise<Comment[]> {
    const rows = await db.comments.where('postId').equals(postId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  },

  async comment(postId: ID, userId: ID, text: string): Promise<Comment | null> {
    assertOwner(userId)
    const body = text.trim()
    if (!body) return null

    const row: Comment = { id: uid('c'), postId, userId, text: body, createdAt: now() }
    await db.comments.add(row)
    await this.recount(postId)
    return row
  },

  /** Only the author may delete their own comment. */
  async removeComment(commentId: ID): Promise<void> {
    const row = await db.comments.get(commentId)
    assertOwnerOf(row)
    await db.comments.delete(commentId)
    if (row) await this.recount(row.postId)
  },

  /**
   * Re-derives the counts the card shows from the rows themselves.
   *
   * The post carries `reactionCount` and `commentCount` denormalised so the
   * feed renders in one read. Recomputing after every write is what stops the
   * number on the card drifting from the rows behind it — the classic failure
   * of a cached count that is only ever incremented.
   */
  async recount(postId: ID): Promise<void> {
    const [reactionCount, commentCount] = await Promise.all([
      db.postReactions.where('postId').equals(postId).count(),
      db.comments.where('postId').equals(postId).count(),
    ])
    await db.posts.update(postId, { reactionCount, commentCount })
  },

  /** Attaches the author and any referenced media in one pass. */
  async hydrate(posts: Post[]): Promise<FeedPost[]> {
    if (posts.length === 0) return []
    const [users, media] = await Promise.all([
      db.users.bulkGet([...new Set(posts.map((p) => p.userId))]),
      mediaService.byIds([...new Set(posts.flatMap((p) => p.mediaIds))]),
    ])
    const byUser = new Map(users.filter(Boolean).map((u) => [u!.id, u!]))
    const byMedia = new Map(media.map((m) => [m.id, m]))

    return posts.flatMap((post) => {
      const author = byUser.get(post.userId)
      // A post with no author is corrupt rather than displayable.
      if (!author) return []
      return [
        {
          ...post,
          author,
          media: post.mediaIds.flatMap((id) => {
            const asset = byMedia.get(id)
            return asset ? [asset] : []
          }),
        },
      ]
    })
  },
}

/** The default for anything posted into this app. */
export const DEFAULT_VISIBILITY: Visibility = 'group'

/**
 * What a post is follows from what it carries.
 *
 * Kept beside the writer rather than asked of the caller, so a photo post can
 * never claim to be a status and a shared workout can never lose its label.
 */
function postTypeFor(input: { mediaIds: ID[]; sharedType?: SharedType }): PostType {
  switch (input.sharedType) {
    case 'workout':
      return 'workout'
    case 'weigh_in':
      return 'weigh_in'
    case 'steps':
      return 'steps'
    case 'achievement':
      return 'achievement'
  }
  return input.mediaIds.length > 0 ? 'photo' : 'status'
}
