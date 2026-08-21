import { db } from '@/lib/db'
import { now, uid } from '@/lib/id'
import type { Comment, ID, MediaAsset, Post, User, Visibility } from '@/models'
import { mediaService } from './mediaService'
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
