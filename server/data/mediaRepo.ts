/**
 * Where a picture lives, and the one route that hands the bytes back.
 *
 * The rule has not changed and is now actually enforceable: **D1 holds a key,
 * R2 holds the object.** A `media_assets` row is an id, an owner, an R2 key, a
 * mime type and a few numbers. No bytes, no base64, no data URI — `register`
 * still refuses a `data:` ref outright, because turning a TEXT column into a
 * file store fails at the third photograph and has to be undone before
 * anything real can ship.
 *
 * Uploads come through the Worker rather than through a presigned URL. R2
 * presigning needs an S3 access key and secret held as deployment secrets and
 * handed to the browser inside a signed URL; that is a second credential to
 * rotate and a second way to write to the bucket. The session cookie already
 * establishes who the caller is, so `upload` uses it and puts the object down
 * itself. The cost is that bytes pass through a Worker, which for photographs
 * and short clips is a few hundred milliseconds and no CPU to speak of.
 *
 * Reading is authorised, never public. The bucket has no public hostname; the
 * only way to an object is `GET /api/data/media/<id>`, which resolves the row,
 * asks `mayRead` whether this caller is allowed it, and only then touches the
 * bucket. See `mayRead` for what "allowed" means — it is not "any approved
 * account", because a private post's photograph is not group content.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

const nowIso = () => new Date().toISOString()

/**
 * The slice of the R2 binding this file uses, declared here.
 *
 * The same choice `server/auth/guard.ts` makes about D1: the server code needs
 * no Workers types at build time, and the real binding satisfies this. It also
 * documents the surface being relied on, which is four methods rather than the
 * whole of R2.
 */
export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
  get(
    key: string,
    options?: { onlyIf?: { etagDoesNotMatch?: string } },
  ): Promise<R2ObjectBody | null>
  delete(key: string): Promise<void>
}

export interface R2ObjectBody {
  body: ReadableStream | null
  size: number
  httpEtag: string
  httpMetadata?: { contentType?: string }
  writeHttpMetadata(headers: Headers): void
}

const KINDS = ['image', 'video'] as const

/**
 * The ceiling on one upload.
 *
 * Matches `MEDIA_MAX_BYTES` in the client's `mediaPick`, so the browser refuses
 * a file before spending a minute sending it and the server refuses the same
 * file if the browser is not ours.
 */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

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
   * Whether this caller may see these bytes.
   *
   * Ownership is the simple half: your own media is yours. The other half is
   * what makes a private post private — a photograph is readable by the group
   * only if something the group can see points at it.
   *
   * So the question is asked of the references, not of the asset. An asset
   * attached to a `group` or `public` post is group content. An asset on a
   * story is too, because a story has no visibility of its own and is shown to
   * everyone by definition. An avatar is, because every screen draws it beside
   * a name. An asset attached to a `private` post, or attached to nothing at
   * all — a draft, an orphan — is readable by its owner and by nobody else.
   *
   * Administrators are deliberately not special here. They can moderate
   * accounts; that is not the same as a key to a photograph somebody chose to
   * keep to themselves.
   */
  async mayRead(db: D1Database, userId: string, asset: { id: string; owner_user_id: string }): Promise<boolean> {
    if (asset.owner_user_id === userId) return true

    const shared = await db
      .prepare(
        `SELECT 1 AS ok
           FROM post_media pm
           JOIN posts p ON p.id = pm.post_id
          WHERE pm.media_id = ? AND p.visibility IN ('group', 'public')
          UNION ALL
         SELECT 1 FROM stories WHERE media_id = ?
          UNION ALL
         SELECT 1 FROM users   WHERE avatar_media_id = ?
          LIMIT 1`,
      )
      .bind(asset.id, asset.id, asset.id)
      .first<{ ok: number }>()

    return Boolean(shared)
  },

  /**
   * Takes the bytes and puts them in the bucket.
   *
   * The metadata rides in the query string rather than in a multipart body:
   * the client already measured the file to draw its preview, and parsing a
   * multipart envelope to recover numbers we were told anyway is work for
   * nothing. The body is the file, unwrapped.
   *
   * The key is `media/<owner>/<id>`, so an object is attributable from its
   * name alone and two people cannot collide. The id is minted here rather
   * than accepted, because an id chosen by the caller is a way to overwrite
   * somebody else's object.
   */
  async upload(
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
    request: Request,
  ): Promise<Response> {
    if (!bucket) {
      return Response.json(
        {
          error: 'storage_unavailable',
          reason: 'no_binding',
          message: 'Photo storage is not configured on this deployment.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const url = new URL(request.url)
    const kind = url.searchParams.get('kind') === 'video' ? 'video' : 'image'
    const mimeType = v.text(url.searchParams.get('mimeType') ?? request.headers.get('Content-Type') ?? '', 'mimeType', 120)
    if (!/^(image|video)\//i.test(mimeType)) {
      throw new v.InvalidInput('mimeType', 'That is not a photo or a video.')
    }

    const declared = Number(request.headers.get('Content-Length') ?? '0')
    if (declared > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: 'too_large', message: 'That file is too large.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const body = await request.arrayBuffer()
    if (body.byteLength === 0) throw new v.InvalidInput('body', 'There were no bytes to store.')
    if (body.byteLength > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: 'too_large', message: 'That file is too large.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const id = `media_${crypto.randomUUID().replace(/-/g, '')}`
    const key = `media/${userId}/${id}`

    await bucket.put(key, body, {
      httpMetadata: { contentType: mimeType, cacheControl: 'private, max-age=31536000, immutable' },
      customMetadata: { owner: userId, kind },
    })

    /*
     * The row is written after the object, so a failed upload leaves no
     * reference to something that is not there. The other order would leave a
     * card drawing a broken image with no way to tell why.
     */
    await this.register(db, userId, {
      id,
      kind,
      ref: key,
      mimeType,
      bytes: body.byteLength,
      width: v.optionalInteger(url.searchParams.get('width') ?? undefined, 'width', { min: 0, max: 20000 }),
      height: v.optionalInteger(url.searchParams.get('height') ?? undefined, 'height', { min: 0, max: 20000 }),
      durationSec: v.optionalInteger(url.searchParams.get('durationSec') ?? undefined, 'durationSec', { min: 0, max: 86400 }),
      createdAt: nowIso(),
    })

    return Response.json(
      { id, key, kind, mimeType, bytes: body.byteLength },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  },

  /**
   * Hands the bytes back, to somebody allowed them.
   *
   * `If-None-Match` is honoured against R2's etag so a feed that draws the
   * same photograph on every scroll pays for it once. The cache header is
   * `private`: these objects are authorised per request, and letting a shared
   * proxy keep one would be handing it to whoever asks next.
   */
  async serve(
    db: D1Database,
    bucket: R2Bucket | undefined,
    user: { id: string },
    mediaId: string,
    request: Request,
  ): Promise<Response> {
    const refuse = (status: number, message: string) =>
      Response.json({ error: 'not_found', message }, { status, headers: { 'Cache-Control': 'no-store' } })

    if (!bucket) return refuse(503, 'Photo storage is not configured on this deployment.')

    const asset = await db
      .prepare('SELECT id, owner_user_id, r2_key, mime_type FROM media_assets WHERE id = ?')
      .bind(mediaId)
      .first<{ id: string; owner_user_id: string; r2_key: string; mime_type: string }>()
    if (!asset) return refuse(404, 'There is no such media.')

    /*
     * A refusal and an absence look the same on purpose. Telling somebody
     * "that exists but is not yours" is telling them it exists.
     */
    if (!(await this.mayRead(db, user.id, asset))) return refuse(404, 'There is no such media.')

    const object = await bucket.get(asset.r2_key, {
      onlyIf: request.headers.get('If-None-Match')
        ? { etagDoesNotMatch: request.headers.get('If-None-Match') as string }
        : undefined,
    })
    if (!object) {
      // Either the object is gone, or the etag matched and R2 returned no body.
      if (request.headers.get('If-None-Match')) {
        return new Response(null, { status: 304, headers: { 'Cache-Control': 'private, max-age=31536000' } })
      }
      return refuse(404, 'There is no such media.')
    }
    if (!('body' in object) || object.body === null) {
      return new Response(null, { status: 304, headers: { 'Cache-Control': 'private, max-age=31536000' } })
    }

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('Content-Type', object.httpMetadata?.contentType ?? asset.mime_type)
    headers.set('etag', object.httpEtag)
    // Private, and long: the key never changes for a given id, so a browser
    // that has it once never needs to ask again.
    headers.set('Cache-Control', 'private, max-age=31536000, immutable')
    headers.set('Content-Length', String(object.size))
    // Videos are scrubbed, which needs ranges.
    headers.set('Accept-Ranges', 'bytes')
    return new Response(object.body, { status: 200, headers })
  },

  /** Removes an object and its row. The owner's, and only the owner's. */
  async remove(db: D1Database, bucket: R2Bucket | undefined, userId: string, mediaId: string): Promise<boolean> {
    const asset = await db
      .prepare('SELECT id, owner_user_id, r2_key FROM media_assets WHERE id = ? AND owner_user_id = ?')
      .bind(mediaId, userId)
      .first<{ r2_key: string }>()
    if (!asset) return false
    if (bucket) await bucket.delete(asset.r2_key)
    await db.prepare('DELETE FROM media_assets WHERE id = ? AND owner_user_id = ?').bind(mediaId, userId).run()
    return true
  },
}
