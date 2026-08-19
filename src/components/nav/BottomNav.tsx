import { NavLink } from 'react-router-dom'
import { House, Activity, Users, MessageCircle, TrendingUp, User, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { chatService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import styles from './BottomNav.module.css'

/**
 * Six destinations and one action.
 *
 * Chat and Progress are peers now rather than things you find inside Group and
 * Activity. Both were a second tap away from a screen that was already busy,
 * and both are checked several times a day — Chat because someone is waiting,
 * Progress because it is the reason any of this is being logged.
 *
 * Seven slots is more than the usual five. The bar is built for it: the labels
 * shrink a step below 380px, the columns can go to zero rather than forcing the
 * grid open, and Create keeps its own raised slot in the middle.
 */
export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/activity', label: 'Activity', icon: Activity, end: false },
  { to: '/group', label: 'Group', icon: Users, end: false },
  { to: '/chat', label: 'Chat', icon: MessageCircle, end: false },
  { to: '/progress', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/me', label: 'Me', icon: User, end: false },
]

/** Fixed floating bar with Create raised in the middle. Phones and tablets. */
export function BottomNav({ onCreate }: { onCreate: () => void }) {
  const [home, activity, group, chat, progress, me] = NAV_ITEMS
  const { user } = useAuth()
  // Unread chat lives here and nowhere else. The bell is for mentions.
  const summary = useLiveQuery(() => (user ? chatService.summary(user.id) : undefined), [user?.id])

  return (
    // The <nav> spans the viewport and only positions; the floating card is the
    // list inside it. Insetting the fixed element itself made it resolve
    // against a containing block wider than the screen and overflow.
    <nav className={styles.nav} aria-label="Main">
      <ul className={`glass ${styles.list}`}>
        <NavItem key={home.to} {...home} />
        <NavItem key={activity.to} {...activity} />
        <NavItem key={group.to} {...group} />

        <li className={styles.logSlot}>
          <button className={styles.logButton} onClick={onCreate} aria-label="Create">
            <Plus size={22} strokeWidth={2.7} />
          </button>
          <span className={styles.logLabel} aria-hidden="true">
            Create
          </span>
        </li>

        <NavItem key={chat.to} {...chat} badge={summary?.unread ?? 0} />
        <NavItem key={progress.to} {...progress} />
        <NavItem key={me.to} {...me} />
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
              <Icon size={19} strokeWidth={isActive ? 2.5 : 1.9} />
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
