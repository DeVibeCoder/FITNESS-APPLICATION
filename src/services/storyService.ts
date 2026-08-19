import { db } from '@/lib/db'
import type { ID, MediaAsset, Story, User } from '@/models'
import { mediaService } from './mediaService'
import { userService } from './userService'

/**
 * Stories: posts with a deadline.
 *
 * Expiry is enforced on read, not by a cleanup job. `expiresAt` is written at
 * creation and every query filters on it, so an expired story cannot surface
 * because something failed to run — which is the only way to make "gone after
 * 24 hours" actually true.
 *
 * Phase 1 provides the model, the expiry rule and the rail. The viewer and the
 * creation flow are Phase 3.
 */

export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface StoryRing {
  user: User
  stories: Story[]
  media: Map<ID, MediaAsset>
  /** True when the viewer has seen every live story from this person. */
  seen: boolean
}

export const storyService = {
  /** Every story that has not expired, oldest first. */
  async live(at: Date = new Date()): Promise<Story[]> {
    const iso = at.toISOString()
    const rows = await db.stories.toArray()
    return rows
      .filter((story) => story.expiresAt > iso)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  },

  /**
   * The rail: one ring per person who has something live, the signed-in user
   * first so "Your story" always sits at the front.
   */
  async rings(viewerId: ID, at: Date = new Date()): Promise<StoryRing[]> {
    const [stories, users] = await Promise.all([this.live(at), userService.listMembers()])
    if (stories.length === 0) return []

    const views = await db.storyViews.where('storyId').anyOf(stories.map((s) => s.id)).toArray()
    const seenByViewer = new Set(
      views.filter((view) => view.userId === viewerId).map((view) => view.storyId),
    )
    const media = await mediaService.byIds(
      stories.flatMap((story) => (story.mediaId ? [story.mediaId] : [])),
    )
    const mediaById = new Map(media.map((asset) => [asset.id, asset]))

    const byUser = new Map<ID, Story[]>()
    for (const story of stories) {
      byUser.set(story.userId, [...(byUser.get(story.userId) ?? []), story])
    }

    const rings: StoryRing[] = []
    for (const user of users) {
      const mine = byUser.get(user.id)
      if (!mine || mine.length === 0) continue
      rings.push({
        user,
        stories: mine,
        media: mediaById,
        seen: mine.every((story) => seenByViewer.has(story.id)),
      })
    }

    // You first, then everyone with something unseen, then the rest.
    return rings.sort((a, b) => {
      if (a.user.id === viewerId) return -1
      if (b.user.id === viewerId) return 1
      return Number(a.seen) - Number(b.seen)
    })
  },

  /** How long a story posted now would last. */
  expiryFrom(createdAt: Date = new Date()): string {
    return new Date(createdAt.getTime() + STORY_LIFETIME_MS).toISOString()
  },

  hasExpired(story: Story, at: Date = new Date()): boolean {
    return story.expiresAt <= at.toISOString()
  },
}
