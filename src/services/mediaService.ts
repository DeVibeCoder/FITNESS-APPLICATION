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
 *  - `blob:…` — a session-scoped URL for something the user has picked but not
 *    yet posted. Marked `temporary`. It exists for the length of a composer
 *    and never reaches a durable row: `upload` replaces it with a key before
 *    anything is saved.
 *  - anything else — an R2 object key, of the shape `media/<owner>/<id>`. This
 *    is what a saved picture is now.
 *
 * Nothing here ever holds the bytes. `upload` streams a `File` straight to the
 * API and keeps the key it is given back; `src` turns a key into the
 * authenticated URL that serves it. Between those two the picture is in R2 and
 * nowhere else.
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

/**
 * Where the bytes for an asset are actually fetched from.
 *
 * One function, because three different screens draw media and all three used
 * to reach for `asset.ref` — which was fine while a ref was a `blob:` URL an
 * `<img>` could use directly, and is wrong now that it is an object key behind
 * an authorised route.
 *
 * A placeholder is drawn by CSS and needs no URL. A draft's `blob:` is used
 * as-is, because it is a local preview of a file the browser already has. A
 * key becomes `/api/data/media/<id>`, which the session cookie authorises like
 * every other request.
 */
export function mediaSrc(asset: Pick<MediaAsset, 'id' | 'ref'>): string {
  if (isPlaceholder(asset.ref)) return ''
  if (isTemporaryRef(asset.ref)) return asset.ref
  return `/api/data/media/${asset.id}`
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
   * Sends the bytes to R2 and records what came back.
   *
   * The id is the server's, not one minted here, because the object is keyed by
   * it — a local id would name a different object on every device. That is also
   * why this returns the asset rather than taking one: the caller cannot know
   * the id until the upload has happened.
   *
   * Throws on failure rather than falling back to a `blob:` ref. A picture that
   * silently becomes temporary is a picture the person believes they posted and
   * which disappears when they close the tab; the composer shows the error
   * instead.
   */
  async upload(file: Blob, picked: MediaInput): Promise<MediaAsset> {
    const query = new URLSearchParams({ kind: picked.kind, mimeType: picked.mimeType })
    if (picked.width !== undefined) query.set('width', String(picked.width))
    if (picked.height !== undefined) query.set('height', String(picked.height))
    if (picked.durationSec !== undefined) query.set('durationSec', String(Math.round(picked.durationSec)))

    const response = await fetch(`/api/data/media/upload?${query}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': picked.mimeType },
      body: file,
    })
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { message?: string }
      throw new Error(detail.message ?? 'That picture could not be saved.')
    }
    const stored = (await response.json()) as { id: ID; key: string }

    const asset: MediaAsset = {
      id: stored.id,
      kind: picked.kind,
      ref: stored.key,
      mimeType: picked.mimeType,
      width: picked.width,
      height: picked.height,
      durationSec: picked.durationSec,
      createdAt: now(),
    }
    // `put`, not `add`: re-uploading after a retry must converge on one row.
    await db.media.put(asset)
    return asset
  },

  /**
   * Records a reference. Rejects anything that looks like embedded binary —
   * a `data:` URL is exactly the mistake this abstraction exists to prevent.
   */
  async register(input: MediaInput): Promise<MediaAsset> {
    if (input.ref.startsWith('data:')) {
      throw new Error('Media must be referenced, not embedded.')
    }

    /*
     * A draft becomes an object here, and this is the only place it happens.
     *
     * Composers hand over a `blob:` URL for the file the person just picked —
     * that is what the preview is drawn from, and it used to be what got
     * stored, which is why pictures survived exactly as long as the tab. The
     * bytes are read back out of that URL and sent to R2; what is stored is
     * the key that comes back.
     *
     * Doing it here rather than in each composer means posts, stories and
     * profile pictures all became durable at once, and a fourth thing that
     * carries a picture gets it for free.
     */
    if (isTemporaryRef(input.ref)) {
      const file = await fetch(input.ref).then((response) => response.blob())
      return this.upload(file, input)
    }

    const asset: MediaAsset = {
      ...input,
      id: uid('media'),
      temporary: undefined,
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
    const [posts, stories, users] = await Promise.all([
      db.posts.toArray(),
      db.stories.toArray(),
      db.users.toArray(),
    ])
    const stillUsed = new Set<ID>([
      ...posts.filter((post) => post.id !== ignore.postId).flatMap((post) => post.mediaIds),
      ...stories
        .filter((story) => story.id !== ignore.storyId)
        .flatMap((story) => (story.mediaId ? [story.mediaId] : [])),
      // Profile pictures are the third thing that carries media, and this is
      // the one place that had to learn about it.
      ...users.flatMap((user) => (user.avatarMediaId ? [user.avatarMediaId] : [])),
    ])
    await this.forget(mediaIds.filter((id) => !stillUsed.has(id)))
  },
}
