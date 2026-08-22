import { useState } from 'react'
import {
  CARD_IMAGES,
  cardImageSrcSet,
  cardImageUrl,
  type CardImageKey,
  type CardPhotoShape,
} from '@/data/cardImages'
import styles from './CardPhoto.module.css'

/**
 * A photograph on a card, in one of two compact shapes.
 *
 *   band — a shallow strip across the top of a card. 84px on a phone, 104px
 *          from 26rem. Enough to read as photography, short enough that the
 *          card is still mostly its numbers.
 *   tile — a 56px rounded square beside a card's numbers. For rows where a
 *          band would double the height of the thing it decorates.
 *
 * Decorative, and marked as such: every card already states in text what it is
 * about, so an alt description here would only make a screen reader say it
 * twice. The subject is recorded in `cardImages.ts` for the humans instead.
 *
 * Two behaviours matter more than the styling:
 *
 * It is purely presentational. The URL goes in an `src` and nowhere else —
 * nothing is written to IndexedDB, to localStorage or to any record, and
 * nothing is uploaded anywhere.
 *
 * It disappears cleanly when it cannot load. This app works offline and these
 * images do not, so a failure is an ordinary Tuesday rather than an
 * exception: on error the element unmounts and the card falls back to the
 * gradient treatment it already had underneath. A torn-image glyph in the
 * middle of a fitness card is worse than no photograph at all.
 */
export function CardPhoto({
  image,
  shape = 'band',
  className,
}: {
  image: CardImageKey
  shape?: CardPhotoShape
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    <img
      className={[styles.photo, styles[shape], className ?? ''].filter(Boolean).join(' ')}
      src={cardImageUrl(image, shape)}
      srcSet={cardImageSrcSet(image, shape)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      /*
       * Read off the image, not passed in by the card: where a photograph
       * wants to be cropped is a fact about the photograph. A card that had to
       * know would get it wrong the first time the picture changed.
       */
      style={{ objectPosition: CARD_IMAGES[image].position }}
    />
  )
}
