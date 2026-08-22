import styles from './CardArt.module.css'

/**
 * Fitness imagery for the cards that carry a section.
 *
 * Drawn rather than photographed, and drawn in *fixed* colours rather than
 * design tokens. That second part is the rule this component exists to keep:
 * an illustration is part of a card's identity, so it has to be the same
 * picture in light and in dark. A picture that changes hue with the theme
 * reads as a rendering fault, not as a design — and a light-mode photograph
 * swapped for a dark-mode one at the theme switch is the same fault with a
 * bigger download.
 *
 * They sit behind the content at low opacity, are marked `aria-hidden`, and
 * carry no text of their own. Used on hero cards, the workout card and the
 * awards highlight — never on a small metric tile, where an image would only
 * make a number harder to read.
 */

export type CardArtVariant = 'strength' | 'run' | 'award'

export function CardArt({
  variant,
  className,
}: {
  variant: CardArtVariant
  className?: string
}) {
  return (
    <span
      className={[styles.art, styles[variant], className ?? ''].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <svg viewBox="0 0 220 160" preserveAspectRatio="xMaxYMid slice" role="presentation">
        {variant === 'strength' ? <Strength /> : null}
        {variant === 'run' ? <Run /> : null}
        {variant === 'award' ? <Award /> : null}
      </svg>
    </span>
  )
}

/*
 * The palette. Two ambers and one deep ember, fixed for good.
 *
 * These are the brand's own values written out longhand. They deliberately do
 * not reference --accent: the token changes between themes and this must not.
 */
const EMBER = '#c2530b'
const AMBER = '#f97316'
const LIFT = '#ffb082'

/** A barbell mid-lift, plates and all, over three motion bars. */
function Strength() {
  return (
    <g fill="none" stroke={AMBER} strokeLinecap="round">
      {/* Motion behind the bar. */}
      <g stroke={EMBER} strokeWidth="6" opacity="0.35">
        <path d="M8 44h54" />
        <path d="M0 80h38" />
        <path d="M14 116h48" />
      </g>

      {/* The bar. */}
      <path d="M52 80h116" stroke={LIFT} strokeWidth="7" />

      {/* Inner plates. */}
      <g stroke={AMBER} strokeWidth="12">
        <path d="M74 54v52" />
        <path d="M146 54v52" />
      </g>

      {/* Outer plates, shorter — the silhouette that says "barbell". */}
      <g stroke={EMBER} strokeWidth="12">
        <path d="M58 66v28" />
        <path d="M162 66v28" />
      </g>

      {/* Collars. */}
      <g stroke={LIFT} strokeWidth="5">
        <path d="M88 68v24" />
        <path d="M132 68v24" />
      </g>
    </g>
  )
}

/** A figure running, reduced to the marks that make it read as running. */
function Run() {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Ground and speed. */}
      <g stroke={EMBER} strokeWidth="6" opacity="0.35">
        <path d="M6 122h70" />
        <path d="M22 96h44" />
        <path d="M0 146h96" />
      </g>

      <circle cx="132" cy="36" r="13" fill={LIFT} stroke="none" />

      {/* Torso and legs: one stride, caught at full extension. */}
      <g stroke={AMBER} strokeWidth="9">
        <path d="M126 54l-8 34" />
        <path d="M118 88l-22 30" />
        <path d="M118 88l30 22 6 28" />
      </g>

      {/* Arms, driving. */}
      <g stroke={EMBER} strokeWidth="8">
        <path d="M126 60l-30 12" />
        <path d="M126 60l28 16" />
      </g>
    </g>
  )
}

/** A medal on a ribbon, with a laurel arc behind it. */
function Award() {
  return (
    <g fill="none" strokeLinecap="round">
      <path
        d="M60 90a52 52 0 0 1 100 0"
        stroke={EMBER}
        strokeWidth="6"
        opacity="0.4"
      />
      {/* Ribbon. */}
      <g stroke={AMBER} strokeWidth="9">
        <path d="M92 24l20 40" />
        <path d="M138 24l-20 40" />
      </g>
      <circle cx="115" cy="98" r="34" fill={AMBER} stroke="none" opacity="0.9" />
      <circle cx="115" cy="98" r="34" stroke={LIFT} strokeWidth="4" />
      {/* A star, drawn as five strokes from the centre. */}
      <g stroke={LIFT} strokeWidth="5">
        <path d="M115 80v36" />
        <path d="M98 92l34 12" />
        <path d="M132 92l-34 12" />
      </g>
    </g>
  )
}
