import type { MediaAsset } from '@/models'

/**
 * Turning a file somebody picked into the metadata a `MediaAsset` needs.
 *
 * Deliberately not a component and not a hook: both composers ask the same
 * questions of a file — is it media, is it small enough, how big is the frame,
 * how long does it run — and the answers have nothing to do with React. Kept
 * here so the two cannot drift, and so the measuring can be reasoned about on
 * its own.
 *
 * Nothing in this file reads the bytes. It measures the file through an object
 * URL the caller already owns, which is the same reference that ends up on the
 * asset — no copy is made and none is stored.
 */

/** Bigger than any phone capture worth attaching; a guard, not a target. */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024

/** A story is a glance. A minute of video is already a generous one. */
export const STORY_VIDEO_MAX_SEC = 60

export interface PickedMedia {
  kind: MediaAsset['kind']
  mimeType: string
  width?: number
  height?: number
  /** Videos only, and the number the story limit is checked against. */
  durationSec?: number
}

export type PickFailure = 'not_media' | 'too_large'

export function classify(file: File): MediaAsset['kind'] | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return null
}

/** What is wrong with this file, if anything. Checked before it is measured. */
export function reject(file: File): PickFailure | null {
  if (classify(file) === null) return 'not_media'
  if (file.size > MEDIA_MAX_BYTES) return 'too_large'
  return null
}

export const PICK_MESSAGE: Record<PickFailure, string> = {
  not_media: 'That file is not a photo or a video.',
  too_large: 'That file is too large.',
}

/**
 * Measures a picked file through its preview URL.
 *
 * Failure is not an error here: a browser that will not decode the file still
 * lets the person post it, just without the dimensions that let a card reserve
 * the right shape. Losing the layout hint is worth less than losing the post.
 */
export async function describeMedia(file: File, url: string): Promise<PickedMedia> {
  const kind = classify(file) ?? 'image'
  const base: PickedMedia = { kind, mimeType: file.type }

  try {
    if (kind === 'video') {
      const { width, height, durationSec } = await measureVideo(url)
      return { ...base, width, height, durationSec }
    }
    const { width, height } = await measureImage(url)
    return { ...base, width, height }
  } catch {
    return base
  }
}

function measureImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('decode_failed'))
    image.src = url
  })
}

function measureVideo(
  url: string,
): Promise<{ width: number; height: number; durationSec: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        // Rounded up: a 60.2s clip is over the limit, and floor would let it in.
        durationSec: Number.isFinite(video.duration) ? Math.ceil(video.duration) : 0,
      })
    }
    video.onerror = () => reject(new Error('decode_failed'))
    video.src = url
  })
}

/**
 * Whether a clip is short enough to be a story.
 *
 * An unmeasurable video passes: the browser could not tell us, and refusing on
 * a number we do not have would block a clip that is probably fine. The limit
 * is a rule about stories, not a trap for browsers that decode badly.
 */
export function withinStoryLimit(media: PickedMedia): boolean {
  if (media.kind !== 'video') return true
  if (!media.durationSec) return true
  return media.durationSec <= STORY_VIDEO_MAX_SEC
}

/**
 * The shape a card should reserve for a piece of media.
 *
 * Clamped between a tall portrait and a wide landscape. Honouring an extreme
 * ratio exactly means one panorama makes a letterboxed sliver and one very
 * tall screenshot takes the entire screen; clamping keeps the feed scannable,
 * and the lightbox is where the whole frame is always available uncropped.
 */
export function displayRatio(asset: Pick<MediaAsset, 'width' | 'height'>): string {
  if (!asset.width || !asset.height) return '4 / 3'
  const ratio = asset.width / asset.height
  const clamped = Math.min(Math.max(ratio, 0.8), 1.7778)
  return `${clamped.toFixed(4)} / 1`
}
