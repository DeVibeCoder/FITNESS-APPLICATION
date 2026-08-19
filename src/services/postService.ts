import { db } from '@/lib/db'
import type { ID, MediaAsset, Post, User, Visibility } from '@/models'
import { mediaService } from './mediaService'

/**
 * The group feed.
 *
 * Phase 1 is the foundation: reads, the visibility rule, and the shapes the
 * feed will render. Creating, reacting and commenting arrive in Phase 2 — the
 * write side deliberately does not exist yet rather than existing half-built.
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
