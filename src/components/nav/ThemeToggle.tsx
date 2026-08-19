import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import styles from './ThemeToggle.module.css'

/**
 * One click, one switch.
 *
 * The icon shows where you are going, not where you are: on a light screen it
 * is a moon, because tapping it gets you the dark one. "System" still exists
 * as a stored preference — a browser that has never been told otherwise
 * follows the OS — but it is not a third thing to choose between here, so the
 * first tap always resolves to an explicit light or dark.
 */
export function ThemeToggle() {
  const { setPref, resolved } = useTheme()
  const goingDark = resolved === 'light'
  const Icon = goingDark ? Moon : Sun

  return (
    <button
      className={styles.trigger}
      onClick={() => setPref(goingDark ? 'dark' : 'light')}
      aria-label={goingDark ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <Icon size={18} strokeWidth={2.1} className={styles.icon} />
    </button>
  )
}
