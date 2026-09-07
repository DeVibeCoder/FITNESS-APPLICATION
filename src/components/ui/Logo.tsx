import styles from './Logo.module.css'

/**
 * The RALLY emblem.
 *
 * An image, not a drawing. The mark is supplied artwork — a graphite tile with
 * the runner breaking through it — and it is rendered here exactly as given.
 * Nothing in this file recolours, recomposes or approximates it; if the emblem
 * ever changes, the file changes and this does not.
 *
 * That is a deliberate reversal of what stood here before, which drew a
 * hexagon in SVG so it could pick up theme colours. This mark carries its own
 * palette — black, graphite, orange-gold — and it is the same mark in light
 * and dark, because a brand that changes with the theme is not one.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/icons/rally-mark.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={styles.mark}
      /*
       * Eager and high priority: this is the first thing on the sign-in screen
       * and in the app bar, and a brand that fades in after the page has
       * settled reads as a broken image for the moment it is missing.
       */
      loading="eager"
      fetchPriority="high"
      draggable={false}
    />
  )
}

/** Mark plus wordmark, for the sign-in screen and the desktop bar. */
export function Logo({ size = 28, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span className={styles.logo}>
      <LogoMark size={size + 8} />
      {showName ? <span className={styles.name}>RALLY</span> : null}
    </span>
  )
}

/**
 * The brand's meaning, spelled out.
 *
 * Only for places with room to read it — the sign-in and setup screens. It is
 * deliberately not exported into the app bar or the icon: a slogan at 22px is
 * a smudge, and one inside an app icon is unreadable at every size an icon is
 * ever drawn.
 */
const WORDS = ['Rise', 'Act', 'Lift', 'Live', 'Yourself'] as const

export function LogoSlogan() {
  return (
    <p className={styles.slogan}>
      {WORDS.map((word, index) => (
        /*
         * The divider belongs to the word before it, not after it. Grouped the
         * other way round, a wrap at 320px put a lone `|` at the start of the
         * second line — the separator arriving before the thing it separates.
         * Each unit is now "RISE |" and the last word stands alone, so a break
         * can only ever happen between a divider and the next word.
         */
        <span key={word} className={styles.unit}>
          <span className={styles.word}>{word}</span>
          {index < WORDS.length - 1 ? (
            <span className={styles.divider} aria-hidden="true">
              |
            </span>
          ) : null}
        </span>
      ))}
    </p>
  )
}
