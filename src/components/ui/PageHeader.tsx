import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
  backTo?: string
  /**
   * The section this page belongs inside, printed above the title as a
   * breadcrumb and used as the back target.
   *
   * A secondary screen has to say which part of the app it is part of — a
   * page that only offers a bare arrow leaves you guessing where the arrow
   * goes, which is how Nutrition came to feel like a separate application
   * rather than a page of Activity.
   */
  parent?: { label: string; to: string }
}

export function PageHeader({ title, subtitle, action, backTo, parent }: PageHeaderProps) {
  const back = backTo ?? parent?.to
  /*
   * A header carrying nothing but the title has nothing to say on a phone —
   * the app bar already prints the page name there, and `.title` is hidden.
   * Left alone it still spends its own padding plus a section gap on printing
   * nothing, which reads as the page starting a long way down.
   */
  const bare = !subtitle && !action && !back

  return (
    <header className={[styles.header, bare ? styles.bare : ''].filter(Boolean).join(' ')}>
      {back ? (
        <Link to={back} className={styles.back} aria-label={parent ? `Back to ${parent.label}` : 'Back'}>
          <ChevronLeft size={20} strokeWidth={2.2} />
        </Link>
      ) : null}
      <div className={styles.text}>
        {parent ? (
          <Link to={parent.to} className={styles.parent}>
            {parent.label}
            <span aria-hidden="true"> ›</span>
          </Link>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  )
}
