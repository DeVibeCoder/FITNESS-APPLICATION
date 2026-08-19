import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import styles from './GroupTabs.module.css'

/**
 * The five sections of the Group area.
 *
 * Chat is not among them. It is a primary destination of its own now — a
 * conversation is not a view of the community dashboard, and putting it here
 * was what made Group feel like a messaging app with statistics attached.
 */
const TABS = [
  { to: '/group', label: 'Overview', end: true },
  { to: '/group/progress', label: 'Progress', end: false },
  { to: '/group/updates', label: 'Updates', end: false },
  { to: '/group/challenge', label: 'Challenge', end: false },
  { to: '/group/awards', label: 'Awards', end: false },
]

export function GroupTabs() {
  const strip = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  /*
   * Below 390px the strip is wider than the screen, so the selected tab can be
   * off the end of it — which would leave someone on Awards looking at a row
   * that appears to have Overview selected. Bringing it into view is the whole
   * point of the scroll being there.
   */
  useEffect(() => {
    const current = strip.current?.querySelector('[aria-current="page"]')
    current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  return (
    <nav className={styles.tabs} aria-label="Group sections" ref={strip}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => [styles.tab, isActive ? styles.active : ''].join(' ')}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
