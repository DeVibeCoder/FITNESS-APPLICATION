import { Link, NavLink, useLocation } from 'react-router-dom'
import { Bell, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { notificationService } from '@/services'
import { Avatar } from '@/components/ui/Avatar'
import { Logo, LogoMark } from '@/components/ui/Logo'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import styles from './TopBar.module.css'

/**
 * The six destinations, mirroring the bottom bar exactly.
 *
 * Desktop has no bottom bar, so this row is the only navigation there — if
 * Chat or Progress were missing here they would simply be unreachable on a
 * wide screen. Create sits in the actions group on the right.
 */
const DESKTOP_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/activity', label: 'Activity', end: false },
  { to: '/group', label: 'Group', end: false },
  { to: '/chat', label: 'Chat', end: false },
  { to: '/progress', label: 'Progress', end: false },
  { to: '/me', label: 'Me', end: false },
]

/** Page titles for the compact mobile header. First match wins, so order. */
const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Circuit'],
  [/^\/activity/, 'Activity'],
  [/^\/chat\/thread/, 'Fitness group'],
  [/^\/chat/, 'Chat'],
  [/^\/me\/activity/, 'My activity'],
  [/^\/me\/admin/, 'Admin'],
  [/^\/me/, 'Me'],
  [/^\/workout\/logs/, 'Logs'],
  [/^\/workout\/plan/, 'Plan'],
  [/^\/workout/, 'Workout'],
  [/^\/nutrition/, 'Nutrition'],
  [/^\/progress/, 'Progress'],
  [/^\/group/, 'Group'],
  [/^\/review/, 'This week'],
  [/^\/motivation/, 'Motivation'],
  [/^\/achievements/, 'Achievements'],
  [/^\/notifications/, 'Notifications'],
  [/^\/profile/, 'Profile'],
  [/^\/more/, 'Privacy & data'],
  [/^\/u\//, 'Member'],
]

function titleFor(pathname: string): string {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Circuit'
}

/**
 * One bar, two shapes.
 *
 * On a phone it is a slim header — mark, page name, theme, you. On a desktop
 * it becomes the primary navigation, which is what replaced the sidebar: this
 * is a consumer fitness app, not an admin console.
 */
export function TopBar() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { open } = useLogSheet()

  // Foundation only: the count is read from seeded rows. Nothing generates
  // notifications automatically yet — that is a later phase, and a server job.
  const unread = useLiveQuery(
    () => (user ? notificationService.unreadCount(user.id) : undefined),
    [user?.id],
  )

  return (
    <header className={`glass ${styles.bar}`}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brandDesktop} aria-label="Circuit — Today">
          <Logo size={22} />
        </Link>

        <Link to="/" className={styles.brandMobile} aria-label="Circuit — Today">
          <LogoMark size={30} />
        </Link>

        {/*
          Announced as the page heading on phones, where there is no room for
          links. On Home it is the brand, which is why it is set as a wordmark
          there and as an ordinary page name everywhere else — the bar has to
          answer "where am I" on twenty screens, not just this one.
        */}
        <h1 className={[styles.title, pathname === '/' ? styles.wordmark : ''].join(' ')}>
          {titleFor(pathname)}
        </h1>

        <nav className={styles.links} aria-label="Main">
          {DESKTOP_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                [styles.link, isActive ? styles.linkActive : ''].filter(Boolean).join(' ')
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.actions}>
          {/*
            Was desktop-only while the bottom bar carried a raised +. That slot
            is gone, so this is now the single entry point to logging on every
            screen size — which is why it is the one filled, coloured control
            in the bar.
          */}
          <button className={styles.create} onClick={() => open()} aria-label="Log activity">
            <Plus size={16} strokeWidth={2.6} />
            <span className={styles.createLabel}>Log</span>
          </button>

          <NavLink
            to="/notifications"
            className={({ isActive }) =>
              [styles.icon, isActive ? styles.iconActive : ''].filter(Boolean).join(' ')
            }
            aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            <Bell size={18} strokeWidth={2.1} />
            {unread ? <span className={styles.badge}>{unread > 9 ? '9+' : unread}</span> : null}
          </NavLink>

          <ThemeToggle />

          {user ? (
            <Link to="/me" className={styles.avatar} aria-label="Your profile">
              <Avatar user={user} size="sm" />
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  )
}
