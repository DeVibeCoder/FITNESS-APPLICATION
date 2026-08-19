import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { DateKey, ID, MotivationVideo } from '@/models'
import { lineOfTheDay } from '@/data/messages'
import { daysBetween, startOfWeek, todayKey } from '@/utils/date'
import { storageService } from './storageService'

/** Shared with the challenge rotation so both advance on the same boundary. */
const ROTATION_EPOCH: DateKey = '2026-01-04'

const pinKey = (weekStart: DateKey) => `featuredVideo:${weekStart}`

/** Explicit order first, then oldest first so the running order is stable. */
function byRotation(a: MotivationVideo, b: MotivationVideo): number {
  const ao = a.rotationOrder ?? Number.MAX_SAFE_INTEGER
  const bo = b.rotationOrder ?? Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  return a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0
}

/**
 * Videos are always external URLs — we never host or upload video. Only the
 * link and its metadata are stored.
 */

export function parseVideoUrl(
  url: string,
): { provider: MotivationVideo['provider']; embedUrl: string; id: string } | null {
  const trimmed = url.trim()
  const youtube = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i,
  )
  if (youtube) {
    return {
      provider: 'youtube',
      id: youtube[1],
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtube[1]}?rel=0`,
    }
  }
  const vimeo = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i)
  if (vimeo) {
    return {
      provider: 'vimeo',
      id: vimeo[1],
      embedUrl: `https://player.vimeo.com/video/${vimeo[1]}`,
    }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { provider: 'other', id: trimmed, embedUrl: trimmed }
  }
  return null
}

/** Remote thumbnail URL for providers that expose one predictably. */
export function thumbnailFor(url: string): string | undefined {
  const parsed = parseVideoUrl(url)
  if (parsed?.provider === 'youtube') return `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`
  return undefined
}

export const motivationService = {
  /** A line that stays the same all day rather than shuffling on every render. */
  quoteOfTheDay(userId: ID): string {
    return lineOfTheDay(`${userId}:${todayKey()}`)
  },

  /** Everything in the collection, in rotation order. */
  async list(): Promise<MotivationVideo[]> {
    const rows = await db.videos.toArray()
    return rows.sort(byRotation)
  },

  /** Just the videos taking part in the weekly rotation. */
  async rotation(): Promise<MotivationVideo[]> {
    const rows = await db.videos.filter((v) => v.isActive).toArray()
    return rows.sort(byRotation)
  },

  /**
   * The video featured for a given week.
   *
   * A pin wins if someone chose one for this week; otherwise it advances one
   * position per week through the rotation. Because the position is a pure
   * function of the date, everyone sees the same video without anything having
   * to be synchronised — and next week's is already decided.
   */
  async featuredForWeek(date: DateKey = todayKey()): Promise<MotivationVideo | undefined> {
    const weekStart = startOfWeek(date)
    const rotation = await this.rotation()
    if (rotation.length === 0) return (await db.videos.toArray())[0]

    const pinnedId = await storageService.getMeta<string>(pinKey(weekStart))
    if (pinnedId) {
      const pinned = rotation.find((v) => v.id === pinnedId)
      if (pinned) return pinned
    }

    const weeks = Math.floor(daysBetween(ROTATION_EPOCH, weekStart) / 7)
    const index = ((weeks % rotation.length) + rotation.length) % rotation.length
    return rotation[index]
  },

  /** What comes up next, so the collection can show the running order. */
  async upcoming(count = 3, date: DateKey = todayKey()): Promise<MotivationVideo[]> {
    const rotation = await this.rotation()
    if (rotation.length === 0) return []
    const weeks = Math.floor(daysBetween(ROTATION_EPOCH, startOfWeek(date)) / 7)
    return Array.from({ length: Math.min(count, rotation.length) }, (_, i) => {
      const index = ((weeks + i + 1) % rotation.length + rotation.length) % rotation.length
      return rotation[index]
    })
  },

  /** Feature a specific video for the week containing `date`. */
  async pinForWeek(id: ID, date: DateKey = todayKey()): Promise<void> {
    await storageService.setMeta(pinKey(startOfWeek(date)), id)
  },

  /** Hand the week back to the automatic rotation. */
  async unpinWeek(date: DateKey = todayKey()): Promise<void> {
    await storageService.setMeta(pinKey(startOfWeek(date)), null)
  },

  async isPinned(date: DateKey = todayKey()): Promise<boolean> {
    return Boolean(await storageService.getMeta<string>(pinKey(startOfWeek(date))))
  },

  /** Include or exclude a video from the weekly rotation. */
  async setInRotation(id: ID, inRotation: boolean): Promise<void> {
    await db.videos.update(id, { isActive: inRotation })
  },

  /** Move a video one place earlier or later in the running order. */
  async reorder(id: ID, direction: -1 | 1): Promise<void> {
    const rotation = await this.rotation()
    const index = rotation.findIndex((v) => v.id === id)
    const swapWith = index + direction
    if (index < 0 || swapWith < 0 || swapWith >= rotation.length) return
    // Rewrite the whole run so orders stay dense even if they started sparse.
    const reordered = [...rotation]
    ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
    await Promise.all(
      reordered.map((video, position) => db.videos.update(video.id, { rotationOrder: position })),
    )
  },

  async active(): Promise<MotivationVideo | undefined> {
    return this.featuredForWeek()
  },

  async add(input: {
    title: string
    url: string
    quote?: string
    addedBy: ID
    makeActive?: boolean
  }): Promise<MotivationVideo | null> {
    const parsed = parseVideoUrl(input.url)
    if (!parsed) return null

    // New videos join the end of the rotation rather than jumping the queue.
    const existing = await db.videos.count()
    const video: MotivationVideo = {
      id: uid('v'),
      title: input.title.trim() || 'Motivation',
      url: input.url.trim(),
      provider: parsed.provider,
      quote: input.quote?.trim() || undefined,
      // A URL, never a copy. Nothing about the video is downloaded.
      thumbnailUrl: thumbnailFor(input.url),
      addedBy: input.addedBy,
      addedAt: now(),
      isActive: true,
      rotationOrder: existing,
    }
    await db.videos.add(video)
    if (input.makeActive) await this.pinForWeek(video.id)
    return video
  },

  async update(
    id: ID,
    changes: { title?: string; url?: string; quote?: string },
  ): Promise<boolean> {
    const video = await db.videos.get(id)
    if (!video) return false

    const patch: Partial<MotivationVideo> = {}
    if (changes.title !== undefined) patch.title = changes.title.trim() || video.title
    if (changes.quote !== undefined) patch.quote = changes.quote.trim() || undefined
    if (changes.url !== undefined && changes.url.trim() !== video.url) {
      const parsed = parseVideoUrl(changes.url)
      if (!parsed) return false
      patch.url = changes.url.trim()
      patch.provider = parsed.provider
      patch.thumbnailUrl = thumbnailFor(changes.url)
    }
    await db.videos.update(id, patch)
    return true
  },

  /** Turns a stored video off without removing it from the collection. */
  async setInactive(id: ID): Promise<void> {
    await db.videos.update(id, { isActive: false })
  },

  /** The embed URL for the player, computed rather than stored. */
  embedUrl(video: MotivationVideo): string | null {
    return parseVideoUrl(video.url)?.embedUrl ?? null
  },

  /** Feature this one for the current week. */
  async setActive(id: ID): Promise<void> {
    await this.pinForWeek(id)
  },

  async remove(id: ID): Promise<void> {
    await db.videos.delete(id)
  },
}
