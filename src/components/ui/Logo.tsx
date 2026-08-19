import { useId } from 'react'
import styles from './Logo.module.css'

/**
 * The Circuit mark: a hexagon holding a barbell-cum-progress glyph.
 *
 * The hexagon is the shape the brand is recognised by at 22px in the app bar,
 * where a thin ring dissolved. The glyph inside reads as a loaded bar from a
 * distance and as three rising bars up close — training and progress in one
 * mark, which is what the app is for.
 *
 * Drawn as one filled tile rather than strokes on transparency, so it holds
 * its weight against both the plum dark theme and the near-white light one.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  /*
   * A unique gradient id per instance.
   *
   * The bar renders two marks — one for desktop, one for mobile — and the
   * unused one is display:none. With a shared literal id, `fill="url(#id)"`
   * resolved against the first definition in the document, which was the
   * hidden one, and Chrome painted nothing. useId makes each instance own its
   * paint server.
   */
  const gradient = useId()

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={styles.mark}
    >
      {/*
        Hardcoded ember, not var(--accent).
        The mark is orange in both themes — it is the brand, and a brand that
        changes hue with the theme is not one. Literal stops also keep the
        gradient independent of custom-property resolution inside <defs>,
        which is where the first attempt silently fell back to nothing.
      */}
      <path d="M32 2 58 17v30L32 62 6 47V17z" fill={`url(#${gradient})`} />
      {/* The bar: two plates and a shaft, knocked out of the tile. */}
      <g fill="#2a0d00">
        <rect x="14" y="26" width="5" height="12" rx="2" />
        <rect x="21" y="22" width="6" height="20" rx="2.5" />
        <rect x="29" y="29" width="6" height="6" rx="2" />
        <rect x="37" y="22" width="6" height="20" rx="2.5" />
        <rect x="45" y="26" width="5" height="12" rx="2" />
      </g>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9542" />
          <stop offset="1" stopColor="#ef4e0c" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/** Mark plus wordmark, for the sign-in screen and the desktop bar. */
export function Logo({ size = 28, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span className={styles.logo}>
      <LogoMark size={size + 8} />
      {showName ? <span className={styles.name}>Circuit</span> : null}
    </span>
  )
}
