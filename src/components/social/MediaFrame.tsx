import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { MediaAsset } from '@/models'
import { isPlaceholder } from '@/services/mediaService'
import styles from './MediaFrame.module.css'

/**
 * Draws a `MediaAsset`.
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
 */
export function MediaFrame({
  asset,
  rounded = true,
  fill = false,
  contain = false,
}: {
  asset: MediaAsset
  rounded?: boolean
  /** Fill whatever box the parent gives it, instead of holding a 4:3 or 3:4. */
  fill?: boolean
  /** Show the whole picture rather than cropping it. Used by the story stage. */
  contain?: boolean
}) {
  const placeholder = isPlaceholder(asset.ref)
  const name = placeholder ? asset.ref.slice('placeholder:'.length) : ''
  const portrait = Boolean(asset.width && asset.height && asset.height > asset.width)
  const [broken, setBroken] = useState(false)

  // A replaced picture is a new reference, so the previous failure means
  // nothing about it.
  useEffect(() => setBroken(false), [asset.ref])

  return (
    <figure
      className={[
        styles.frame,
        rounded ? styles.rounded : '',
        fill ? styles.fill : portrait ? styles.portrait : styles.landscape,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {placeholder ? (
        <span className={`${styles.art} ${styles[name] ?? ''}`} aria-hidden="true" />
      ) : broken ? (
        <div className={styles.gone}>
          <ImageOff size={20} strokeWidth={1.9} />
          <p className={styles.goneText}>This photo was only kept for that session.</p>
        </div>
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
