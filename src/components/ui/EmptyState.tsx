import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  body: string
  action?: ReactNode
  compact?: boolean
}

/** Never a blank panel — an empty screen still says something useful. */
export function EmptyState({ icon, title, body, action, compact }: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.compact : ''].filter(Boolean).join(' ')}>
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{body}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

export function Skeleton({ height = 72, radius = 'var(--r-lg)' }: { height?: number; radius?: string }) {
  return <div className={styles.skeleton} style={{ height, borderRadius: radius }} />
}

export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
