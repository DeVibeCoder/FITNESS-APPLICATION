import { NavLink } from 'react-router-dom'
import { House, Activity, Users, MessageCircle, TrendingUp, User } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { chatService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import styles from './BottomNav.module.css'

/**
 * Six destinations, and no action.
 *
 * Logging moved to the Log button in the header, which freed the centre slot
 * the raised + used to occupy. That is a straight win: the raised button was
 * the widest thing in the bar and it was not a destination, so it cost a
 * column and broke the rhythm of the row for a control that belongs with the
 * other one-off actions.
 *
 * Chat and Progress are peers rather than things you find inside Group and
 * Activity — both are checked several times a day, Chat because someone is
 * waiting and Progress because it is the reason any of this is being logged.
 */
export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/activity', label: 'Activity', icon: Activity, end: false },
  { to: '/group', label: 'Group', icon: Users, end: false },
  { to: '/chat', label: 'Chat', icon: MessageCircle, end: false },
  { to: '/progress', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/me', label: 'Me', icon: User, end: false },
]

/** Fixed bar across the foot of the screen. Phones and tablets. */
export function BottomNav() {
  const { user } = useAuth()
  // Unread chat lives here and nowhere else. The bell is for mentions.
  const summary = useLiveQuery(() => (user ? chatService.summary(user.id) : undefined), [user?.id])

  return (
    // The <nav> spans the viewport and only positions; the floating card is the
    // list inside it. Insetting the fixed element itself made it resolve
    // against a containing block wider than the screen and overflow.
    <nav className={styles.nav} aria-label="Main">
      <ul className={styles.list}>
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            badge={item.to === '/chat' ? (summary?.unread ?? 0) : 0}
          />
        ))}
      </ul>
    </nav>
  )
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  badge = 0,
}: (typeof NAV_ITEMS)[number] & { badge?: number }) {
  return (
    <li className={styles.item}>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) => [styles.link, isActive ? styles.active : ''].join(' ')}
      >
        {({ isActive }) => (
          <>
            <span className={styles.iconWrap}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.9} />
              {badge > 0 ? (
                <span className={styles.badge}>
                  {badge > 9 ? '9+' : badge}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
            </span>
            <span className={styles.label}>{label}</span>
          </>
        )}
      </NavLink>
    </li>
  )
}
