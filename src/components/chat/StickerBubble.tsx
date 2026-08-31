import { STICKER_BY_KEY } from '@/data/stickers'
import styles from './StickerBubble.module.css'

/**
 * One of the app's stickers, drawn.
 *
 * Nothing is fetched and nothing was stored: the message holds a key, and this
 * turns the key into a glyph and a word. A sticker whose key is no longer in
 * the set says so rather than rendering an empty card — keys are permanent, so
 * that should never happen, and if it does it is worth seeing.
 */
export function StickerBubble({ stickerId, size = 'md' }: { stickerId: string; size?: 'sm' | 'md' }) {
  const sticker = STICKER_BY_KEY.get(stickerId)
  if (!sticker) return <span className={styles.missing}>Sticker unavailable</span>

  return (
    <span
      className={[styles.sticker, styles[sticker.tone], size === 'sm' ? styles.small : '']
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={`Sticker: ${sticker.label}`}
    >
      <span className={styles.glyph} aria-hidden="true">
        {sticker.glyph}
      </span>
      <span className={styles.word} aria-hidden="true">
        {sticker.word}
      </span>
    </span>
  )
}
