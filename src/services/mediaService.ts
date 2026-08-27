import { db } from '@/lib/db'
import { now, uid } from '@/lib/id'
import type { ID, MediaAsset } from '@/models'

/**
 * Media is referenced, never stored.
 *
 * The rule this service exists to enforce: no binary, no base64 and no Blob
 * ever reaches the database. A `MediaAsset` row is metadata plus a pointer,
 * and the pointer is one of three things:
 *
 *  - `placeholder:<name>` — the UI draws it from CSS. Used by seed content, so
 *    the demo can show a photo post without shipping a stock photograph.
 *  - `blob:…` — a session-scoped URL for something the user just picked. Marked
 *    `temporary`, because it dies with the page and must never be mistaken for
 *    durable storage.
 *  - anything else — an object-storage key. That is the shape Cloudflare R2 or
 *    an equivalent will use, and nothing above this service changes when it
 *    arrives.
 */

/** Refs the UI knows how to draw itself, with no network and no asset file. */
export const PLACEHOLDER_REFS = [
  'placeholder:sunrise',
  'placeholder:track',
  'placeholder:ridge',
] as const

export function isPlaceholder(ref: string): boolean {
  return ref.startsWith('placeholder:')
}

export function isTemporaryRef(ref: string): boolean {
  return ref.startsWith('blob:') || ref.startsWith('data:')
}

/**
 * What a composer hands over: metadata and a pointer.
 *
 * The same shape whether the picture is going onto a post or into a story —
 * neither of them has ever seen the bytes, which is the whole point.
 */
export interface MediaInput {
  kind: MediaAsset['kind']
  ref: string
  mimeType: string
  width?: number
  height?: number
  durationSec?: number
}

export const mediaService = {
  get(id: ID): Promise<MediaAsset | undefined> {
    return db.media.get(id)
  },

  async byIds(ids: ID[]): Promise<MediaAsset[]> {
    if (ids.length === 0) return []
    const rows = await db.media.bulkGet(ids)
    return rows.filter((row): row is MediaAsset => Boolean(row))
  },

  /**
   * Records a reference. Rejects anything that looks like embedded binary —
   * a `data:` URL is exactly the mistake this abstraction exists to prevent.
   */
  async register(input: MediaInput): Promise<MediaAsset> {
    if (input.ref.startsWith('data:')) {
      throw new Error('Media must be referenced, not embedded.')
    }
    const asset: MediaAsset = {
      ...input,
      id: uid('media'),
      temporary: isTemporaryRef(input.ref) || undefined,
      createdAt: now(),
    }
    await db.media.add(asset)
    return asset
  },

  /**
   * Drops references nothing points at any more.
   *
   * A `blob:` ref is revoked on the way out: the row was the only record that
   * the URL had been handed out at all, so this is the one place that can free
   * it. When object storage arrives, deleting the object belongs here too —
   * which is the reason callers say "forget this reference" rather than
   * deleting the row themselves.
   */
  async forget(ids: ID[]): Promise<void> {
    if (ids.length === 0) return
    const rows = await this.byIds(ids)
    await db.media.bulkDelete(ids)
    for (const row of rows) {
      // Guarded because the data layer is also exercised outside a browser.
      if (row.ref.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(row.ref)
      }
    }
  },

  /**
   * Forgets whichever of these references nothing points at any more.
   *
   * Deliberately a scan rather than a stored reference count: a count that is
   * only ever incremented is the same bug as a cached comment total, and at
   * three people's worth of content the scan costs nothing. `ignore` names the
   * row that is being deleted or edited, which by definition should not count
   * as still using its own picture.
   *
   * Knowing who references media belongs here rather than in each caller —
   * when a third thing starts carrying pictures, this is the only place that
   * has to learn about it.
   */
  async releaseUnused(
    mediaIds: ID[],
    ignore: { postId?: ID; storyId?: ID } = {},
  ): Promise<void> {
    if (mediaIds.length === 0) return
    const [posts, stories] = await Promise.all([db.posts.toArray(), db.stories.toArray()])
    const stillUsed = new Set<ID>([
      ...posts.filter((post) => post.id !== ignore.postId).flatMap((post) => post.mediaIds),
      ...stories
        .filter((story) => story.id !== ignore.storyId)
        .flatMap((story) => (story.mediaId ? [story.mediaId] : [])),
    ])
    await this.forget(mediaIds.filter((id) => !stillUsed.has(id)))
  },
}
