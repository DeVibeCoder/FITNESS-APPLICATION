import { useState } from 'react'
import {
  CARD_IMAGE_SIZES,
  CARD_IMAGES,
  cardImageSrcSet,
  cardImageUrl,
  type CardImageKey,
} from '@/data/cardImages'
import styles from './CardPhoto.module.css'

/**
 * A photograph filling a card, with the card's own content over it.
 *
 * Positioned rather than laid out: it is absolutely placed against the card's
 * box, so it adds no height whatever. That is what lets a card carry a
 * full-bleed photograph and still be short — the height is decided entirely by
 * the numbers and the buttons, exactly as it was before the picture arrived.
 *
 * Three things make it work, and all three matter:
 *
 * The **ground** is a dark warm gradient that is always painted, image or no
 * image. The card's text is fixed light — see `.onPhoto` in base.css — so
 * something underneath has to guarantee it is readable. If the ground came
 * from the photograph, an offline phone would get white text on a white card,
 * which is not a degraded experience but an unusable one.
 *
 * The **scrim** sits over the photograph and under the content. Photographs
 * are unpredictable — a bright kitchen and a dark gym both end up here — so it
 * is deliberately heavier than looks necessary on any one of them.
 *
 * The **failure path** hides only the `<img>`. The ground and the scrim
 * remain, so a card that cannot reach the CDN looks like a deliberately dark
 * card rather than a broken one.
 *
 * Decorative throughout: every card already says in text what it is about, so
 * this is `aria-hidden` and carries no alt description. The subject of each
 * frame is recorded in `cardImages.ts` for the people reading the code.
 */
export function CardPhoto({ image, className }: { image: CardImageKey; className?: string }) {
  const [failed, setFailed] = useState(false)

  return (
    <span className={[styles.fill, className ?? ''].filter(Boolean).join(' ')} aria-hidden="true">
      {failed ? null : (
        <img
          className={styles.image}
          src={cardImageUrl(image)}
          srcSet={cardImageSrcSet(image)}
          sizes={CARD_IMAGE_SIZES}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          /*
           * Read off the image, not passed in by the card: where a photograph
           * wants to be cropped is a fact about the photograph. A card that had
           * to know would get it wrong the first time the picture changed.
           */
          style={{ objectPosition: CARD_IMAGES[image].position }}
        />
      )}
      <span className={styles.scrim} />
    </span>
  )
}
