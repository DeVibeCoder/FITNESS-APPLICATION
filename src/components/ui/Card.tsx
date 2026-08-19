import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './Card.module.css'

interface CardProps {
  children: ReactNode
  className?: string
  /** Removes the inner padding when the card owns its own layout. */
  flush?: boolean
  tone?: 'default' | 'inverse' | 'accent'
}

export function Card({ children, className, flush, tone = 'default' }: CardProps) {
  return (
    <section
      className={[styles.card, styles[tone], flush ? styles.flush : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  )
}

export function CardLink({ to, children, className, flush, tone = 'default' }: CardProps & { to: string }) {
  return (
    <Link
      to={to}
      className={[styles.card, styles[tone], styles.interactive, flush ? styles.flush : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Link>
  )
}

interface SectionProps {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** An eyebrow label, an optional action, and the content underneath. */
export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={[styles.section, className ?? ''].filter(Boolean).join(' ')}>
      <header className={styles.sectionHead}>
        <h2 className="eyebrow">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}
