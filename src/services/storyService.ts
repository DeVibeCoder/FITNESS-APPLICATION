import { db, DataError } from '@/lib/db'
import { now, uid } from '@/lib/id'
import type { ID, MediaAsset, Story, StoryView, User } from '@/models'
import { mediaService } from './mediaService'
import type { MediaInput } from './mediaService'
import { assertOwner, assertOwnerOf } from './ownership'
import { userService } from './userService'

/**
 * Stories: posts with a deadline.
 *
 * Expiry is enforced on read, not by a cleanup job. `expiresAt` is written at
 * creation and every query filters on it, so an expired story cannot surface
 * because something failed to run — which is the only way to make "gone after
 * 24 hours" actually true.
 *
 * Stories are group-only. There is no `visibility` field and deliberately no
 * public story: the rail is built from `listMembers`, so an account still
 * waiting on approval neither appears in it nor sees anybody in it.
 */

export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000

/** A story is a photo, a few words, or both. Nothing else is offered. */
export interface NewStory {
  userId: ID
  text?: string
  media?: MediaInput
}

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

  // --- Writing -------------------------------------------------------------

  /**
   * Posts a story.
   *
   * `expiresAt` is written here and never recomputed, so "gone after 24 hours"
   * is a property of the row rather than of whatever is reading it. The
   * picture goes through `mediaService`, which is the single place the
   * reference-never-bytes rule is enforced; if the story itself fails to land
   * the asset row goes with it.
   */
  async create(input: NewStory): Promise<Story> {
    // You post as yourself. The same rule a server would apply.
    assertOwner(input.userId)

    const text = input.text?.trim() ?? ''
    if (!text && !input.media) {
      throw new DataError('A story needs a photo or a few words.')
    }

    const asset = input.media ? await mediaService.register(input.media) : undefined
    const createdAt = new Date()
    const story: Story = {
      id: uid('st'),
      userId: input.userId,
      // What it is follows from what it carries, exactly as a post's type does.
      type: asset ? 'photo' : 'text',
      text: text || undefined,
      mediaId: asset?.id,
      createdAt: createdAt.toISOString(),
      expiresAt: this.expiryFrom(createdAt),
    }

    try {
      await db.stories.add(story)
    } catch (error) {
      // Never leave a reference behind pointing at a story that never landed.
      if (asset) await db.media.delete(asset.id)
      throw error
    }
    return story
  },

  /**
   * Deletes your own story, and the views that only existed because of it.
   *
   * A story is gone the moment its author says so — there is no soft delete,
   * because unlike a chat message nothing else quotes a story or holds a place
   * in a conversation for it.
   */
  async remove(storyId: ID): Promise<void> {
    const story = await db.stories.get(storyId)
    // Only the author. Enforced here rather than in the viewer, because the
    // viewer is not what a server would trust.
    assertOwnerOf(story)
    if (!story) return

    const viewKeys = await db.storyViews.where('storyId').equals(storyId).primaryKeys()
    await db.storyViews.bulkDelete(viewKeys)
    await db.stories.delete(storyId)
    if (story.mediaId) await mediaService.releaseUnused([story.mediaId], { storyId })
  },

  // --- Views ---------------------------------------------------------------

  /**
   * Records that someone watched a story.
   *
   * Your own story is never a view: a rail that marked itself seen the moment
   * you opened it would make "seen by" meaningless, and looking at your own
   * post is not an audience. Writing twice is a no-op, so re-opening a story
   * cannot inflate the count.
   */
  async markSeen(storyId: ID, viewerId: ID): Promise<boolean> {
    // You watch as yourself; nobody is marked as having watched on your behalf.
    assertOwner(viewerId)
    const story = await db.stories.get(storyId)
    if (!story || story.userId === viewerId) return false

    const existing = await db.storyViews
      .where('[storyId+userId]')
      .equals([storyId, viewerId])
      .first()
    if (existing) return false

    const view: StoryView = { id: uid('sv'), storyId, userId: viewerId, viewedAt: now() }
    await db.storyViews.add(view)
    return true
  },

  /**
   * Who watched one of your stories.
   *
   * The author's own view of their own audience, and nothing more: names, in
   * the order they watched. No timestamps per person, because "Nadia watched
   * this at 02:14" is not information anybody needs and is not ours to hand
   * out.
   */
  async viewersOf(storyId: ID): Promise<User[]> {
    const story = await db.stories.get(storyId)
    assertOwnerOf(story)
    if (!story) return []

    const views = (await db.storyViews.where('storyId').equals(storyId).toArray()).sort((a, b) =>
      a.viewedAt < b.viewedAt ? -1 : 1,
    )
    const members = new Map((await userService.listMembers()).map((user) => [user.id, user]))
    return views.flatMap((view) => {
      const user = members.get(view.userId)
      return user ? [user] : []
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
