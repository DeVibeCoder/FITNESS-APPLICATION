import { useEffect, useState } from 'react'
import { ImageOff, Play } from 'lucide-react'
import type { MediaAsset } from '@/models'
import { isPlaceholder } from '@/services/mediaService'
import { displayRatio } from '@/lib/mediaPick'
import { duration } from '@/utils/format'
import styles from './MediaFrame.module.css'

/**
 * Draws a `MediaAsset` — a picture or a clip.
 *
 * A `placeholder:` reference is rendered from CSS — an abstract athletic
 * gradient, not a photograph. That is how the demo can show a picture post
 * without shipping stock imagery, and it keeps the media abstraction honest:
 * the database holds a reference, and something else decides how to paint it.
 *
 * A temporary reference (`blob:`) is drawn but labelled, because it will not
 * survive a reload and pretending otherwise would be a lie. Once it has
 * actually expired the frame says so in words, rather than leaving the browser
 * to draw its broken-image glyph in the middle of the feed.
 *
 * Video never autoplays. In a feed it is a still first frame with a play badge
 * and its length, and pressing it opens the viewer that actually plays it — a
 * feed that starts playing at you is one people scroll past faster.
 */
export function MediaFrame({
  asset,
  rounded = true,
  fill = false,
  contain = false,
  natural = false,
  controls = false,
  autoPlay = false,
}: {
  asset: MediaAsset
  rounded?: boolean
  /** Fill whatever box the parent gives it, instead of holding a 4:3 or 3:4. */
  fill?: boolean
  /** Show the whole frame rather than cropping it. Used by the story stage. */
  contain?: boolean
  /** Use the media's own shape, clamped — how the feed presents a post. */
  natural?: boolean
  /** Real playback controls. The viewer sets this; the feed never does. */
  controls?: boolean
  /**
   * Plays on its own, muted. Only the story stage sets it: a story is
   * something you opened deliberately and it is expected to start, which is
   * the opposite of a clip that starts at you while you are scrolling a feed.
   */
  autoPlay?: boolean
}) {
  const placeholder = isPlaceholder(asset.ref)
  const name = placeholder ? asset.ref.slice('placeholder:'.length) : ''
  const portrait = Boolean(asset.width && asset.height && asset.height > asset.width)
  const [broken, setBroken] = useState(false)

  // A replaced picture is a new reference, so the previous failure means
  // nothing about it.
  useEffect(() => setBroken(false), [asset.ref])

  const shape = fill
    ? styles.fill
    : natural
      ? styles.natural
      : portrait
        ? styles.portrait
        : styles.landscape

  return (
    <figure
      className={[styles.frame, rounded ? styles.rounded : '', shape].filter(Boolean).join(' ')}
      style={natural && !fill ? { aspectRatio: displayRatio(asset) } : undefined}
    >
      {placeholder ? (
        <span className={`${styles.art} ${styles[name] ?? ''}`} aria-hidden="true" />
      ) : broken ? (
        <div className={styles.gone}>
          <ImageOff size={20} strokeWidth={1.9} />
          <p className={styles.goneText}>
            This {asset.kind === 'video' ? 'clip' : 'photo'} was only kept for that session.
          </p>
        </div>
      ) : asset.kind === 'video' ? (
        <>
          <video
            src={asset.ref}
            className={[styles.image, contain ? styles.contain : ''].filter(Boolean).join(' ')}
            /* Metadata only: enough to paint a first frame, not the whole clip. */
            preload="metadata"
            playsInline
            controls={controls}
            autoPlay={autoPlay}
            /* Muted is what makes autoplay allowed at all; a story is watched,
               not listened to, until somebody unmutes it themselves. */
            muted={autoPlay}
            loop={autoPlay && !controls}
            onError={() => setBroken(true)}
          />
          {controls || autoPlay ? null : (
            <>
              <span className={styles.playBadge} aria-hidden="true">
                <Play size={18} strokeWidth={2.4} fill="currentColor" />
              </span>
              {asset.durationSec ? (
                <span className={`${styles.length} tnum`}>{duration(asset.durationSec)}</span>
              ) : null}
            </>
          )}
        </>
      ) : (
        <img
          src={asset.ref}
          alt=""
          className={[styles.image, contain ? styles.contain : ''].filter(Boolean).join(' ')}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      )}
      {asset.temporary && !broken ? (
        <figcaption className={styles.temp}>Not saved</figcaption>
      ) : null}
    </figure>
  )
}
