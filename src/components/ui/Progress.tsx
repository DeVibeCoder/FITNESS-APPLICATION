import { clamp } from '@/utils/format'
import styles from './Progress.module.css'

interface BarProps {
  value: number
  max: number
  /** Overrides the fill colour; defaults to the accent. */
  tone?: 'accent' | 'success' | 'neutral' | 'warn' | 'move' | 'energy'
  size?: 'sm' | 'md'
  label?: string
}

export function ProgressBar({ value, max, tone = 'accent', size = 'md', label }: BarProps) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0
  return (
    <div
      className={[styles.track, styles[size]].join(' ')}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={[styles.fill, styles[tone]].join(' ')} style={{ width: `${pct}%` }} />
    </div>
  )
}

interface RingProps {
  value: number
  max: number
  size?: number
  thickness?: number
  tone?: 'accent' | 'success' | 'move' | 'energy'
  children?: React.ReactNode
  label?: string
}

/** A single progress ring. Used sparingly — one per screen at most. */
const RING_STROKE: Record<string, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  move: 'var(--move)',
  energy: 'var(--energy)',
}

export function Ring({
  value,
  max,
  size = 92,
  thickness = 9,
  tone = 'accent',
  children,
  label,
}: RingProps) {
  const pct = max > 0 ? clamp(value / max, 0, 1) : 0
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div
      className={styles.ring}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={thickness}
        />
        <circle
          className={styles.ringFill}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={RING_STROKE[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children ? <div className={styles.ringLabel}>{children}</div> : null}
    </div>
  )
}
