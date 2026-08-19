import styles from './Logo.module.css'

/**
 * The Circuit mark: an open ring closing on itself, drawn twice at different
 * weights. It reads as a progress ring at any size, which is the whole idea.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M256 108 A148 148 0 1 1 118.5 202"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="58"
        strokeLinecap="round"
      />
      <path
        d="M256 182 A74 74 0 1 1 194.5 213"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="58"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Mark plus wordmark, for the sign-in screen and the desktop bar. */
export function Logo({ size = 28, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span className={styles.logo}>
      <span className={styles.tile} style={{ '--tile': `${size + 14}px` } as React.CSSProperties}>
        <LogoMark size={size} />
      </span>
      {showName ? <span className={styles.name}>Circuit</span> : null}
    </span>
  )
}
