import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
  backTo?: string
}

export function PageHeader({ title, subtitle, action, backTo }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {backTo ? (
        <Link to={backTo} className={styles.back} aria-label="Back">
          <ChevronLeft size={20} strokeWidth={2.2} />
        </Link>
      ) : null}
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  )
}
