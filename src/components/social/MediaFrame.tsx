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
 * survive a reload and pretending otherwise would be a lie.
 */
export function MediaFrame({ asset, rounded = true }: { asset: MediaAsset; rounded?: boolean }) {
  const placeholder = isPlaceholder(asset.ref)
  const name = placeholder ? asset.ref.slice('placeholder:'.length) : ''
  const portrait = Boolean(asset.width && asset.height && asset.height > asset.width)

  return (
    <figure
      className={[
        styles.frame,
        rounded ? styles.rounded : '',
        portrait ? styles.portrait : styles.landscape,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {placeholder ? (
        <span className={`${styles.art} ${styles[name] ?? ''}`} aria-hidden="true" />
      ) : (
        <img
          src={asset.ref}
          alt=""
          className={styles.image}
          loading="lazy"
          decoding="async"
        />
      )}
      {asset.temporary ? <figcaption className={styles.temp}>Not saved</figcaption> : null}
    </figure>
  )
}
