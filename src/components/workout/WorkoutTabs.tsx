import { NavLink } from 'react-router-dom'
import styles from './WorkoutTabs.module.css'

const TABS = [
  { to: '/workout', label: 'Today', end: true },
  { to: '/workout/plan', label: 'Plan', end: false },
  { to: '/workout/logs', label: 'Logs', end: false },
]

/**
 * Section tabs inside the Workout area. Deliberately not extra bottom-nav
 * items — the main navigation stays at four destinations plus the log action.
 */
export function WorkoutTabs() {
  return (
    <nav className={styles.tabs} aria-label="Workout sections">
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
