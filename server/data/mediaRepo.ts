/**
 * Media metadata, and the shape of the storage that is not there yet.
 *
 * A `media_assets` row is a pointer and a few numbers: an object key, a mime
 * type, dimensions. No bytes. That rule is the reason this file can exist and
 * be correct while the bucket behind it does not, and it is also why there is
 * no clever interim: a data URI or a base64 blob in a TEXT column would turn
 * D1 into a file store, blow past its row limits at the third photograph, and
 * have to be undone before anything real could ship.
 *
 * WHAT IS OUTSTANDING
 *
 * R2 is not enabled on this Cloudflare account. Creating a bucket fails with
 * error code 10042, which is the account-level refusal, not a naming or
 * permissions problem — no bucket name, token scope or API version changes it.
 * The single prerequisite is that R2 be enabled for the account in the
 * Cloudflare dashboard, which requires accepting the R2 terms and adding a
 * billing method; it cannot be done from the API with the credentials this
 * project holds, and retrying the create call is not going to be what fixes
 * it.
 *
 * When that is done, three things connect and nothing else changes:
 *
 *   1. Uncomment the `r2_buckets` blocks already sitting in wrangler.toml.
 *   2. `uploadUnavailable` below becomes a presigned-PUT handler that hands
 *      back `{ url, key }` for the browser to upload to directly.
 *   3. `register` starts being called with the key that upload returned,
 *      instead of the local ref it takes today.
 *
 * Until then the application keeps its existing safe behaviour: pictures are
 * held as session-scoped `blob:` refs that the UI already marks as temporary,
 * and nothing pretends they are durable.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

const nowIso = () => new Date().toISOString()

const KINDS = ['image', 'video'] as const

export function validateMedia(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    kind: v.oneOf(raw.kind, 'kind', KINDS),
    /**
     * The storage key. Refused if it looks like the bytes themselves — that
     * is the mistake this whole file is arranged to prevent, so it is checked
     * rather than trusted.
     */
    ref: v.text(raw.ref, 'ref', 500),
    mimeType: v.text(raw.mimeType, 'mimeType', 120),
    bytes: v.optionalInteger(raw.bytes, 'bytes', { min: 0, max: 500_000_000 }),
    width: v.optionalInteger(raw.width, 'width', { min: 0, max: 20000 }),
    height: v.optionalInteger(raw.height, 'height', { min: 0, max: 20000 }),
    durationSec: v.optionalInteger(raw.durationSec, 'durationSec', { min: 0, max: 86400 }),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export const mediaRepo = {
  async byIds(db: D1Database, ids: string[]) {
    if (ids.length === 0) return []
    const holes = ids.map(() => '?').join(', ')
    const { results } = await db
      .prepare(`SELECT * FROM media_assets WHERE id IN (${holes})`)
      .bind(...ids)
      .all()
    return results ?? []
  },

  /**
   * Records where a picture lives. Refuses to record the picture itself.
   */
  async register(db: D1Database, userId: string, input: ReturnType<typeof validateMedia>) {
    if (/^data:/i.test(input.ref) || input.ref.length > 400) {
      throw new v.InvalidInput('ref', 'Media is referenced by key, never embedded.')
    }
    await db
      .prepare(
        `INSERT INTO media_assets
           (id, owner_user_id, r2_key, kind, mime_type, bytes, width, height, duration_sec, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        input.id, userId, input.ref, input.kind, input.mimeType,
        input.bytes, input.width, input.height, input.durationSec, input.createdAt,
      )
      .run()
  },

  /**
   * The upload endpoint, answering honestly.
   *
   * 503 rather than 404 or 500: the route exists and the client is not at
   * fault, the storage behind it is simply not available yet. The body says
   * so in a code a client can branch on, so the composer can fall back to its
   * temporary local ref rather than showing an error for something the user
   * cannot fix.
   */
  uploadUnavailable(): Response {
    return Response.json(
      {
        error: 'storage_unavailable',
        reason: 'r2_not_enabled',
        message: 'Photo storage is not switched on yet. Your picture stays on this device for now.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  },
}
