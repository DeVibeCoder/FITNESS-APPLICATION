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
  async register(input: {
    kind: MediaAsset['kind']
    ref: string
    mimeType: string
    width?: number
    height?: number
    durationSec?: number
  }): Promise<MediaAsset> {
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
}
