import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AtSign, Award, Bell, Heart, MessageCircle, Scale, Target } from 'lucide-react'
import { db } from '@/lib/db'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { notificationService } from '@/services'
import type { NotificationKind } from '@/models'
import { timeAgo } from '@/utils/date'
import styles from './Notifications.module.css'

const ICONS: Record<NotificationKind, typeof Bell> = {
  post_reaction: Heart,
  comment: MessageCircle,
  mention: AtSign,
  story: Bell,
  achievement: Award,
  challenge: Target,
  weigh_in_reminder: Scale,
  workout_activity: Bell,
}

/**
 * Notifications.
 *
 * What reaches this screen is deliberately narrow: someone tagged you, someone
 * reacted to or commented on something of yours, an account was approved, a
 * milestone landed. Chat traffic does not — being in a busy group would
 * otherwise bury everything that needs an answer under everything that does
 * not. Unread messages are the Chat tab's badge and nothing else.
 *
 * Mentions are generated for real, in chatService. The rest are still seeded:
 * delivery is a server's job in a later phase, and saying so plainly beats a
 * screen that looks live but never changes.
 */
export function Notifications() {
  const { user } = useAuth()
  const { guard } = useToast()

  const rows = useLiveQuery(
    () => (user ? notificationService.listFor(user.id) : undefined),
    [user?.id],
  )
  const users = useLiveQuery(() => db.users.toArray(), [])

  if (!user || rows === undefined || users === undefined) return <LoadingScreen />

  const byId = new Map(users.map((u) => [u.id, u]))
  const unread = rows.filter((row) => !row.readAt).length

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'All caught up'}
        action={
          unread ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => guard(() => notificationService.markAllRead(user.id))}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          body="Mentions, reactions and comments show up here. Ordinary chat messages do not — those live on the Chat tab."
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const Icon = ICONS[row.kind] ?? Bell
            const actor = row.actorId ? byId.get(row.actorId) : undefined
            const body = (
              <>
                <span className={styles.avatar}>
                  {actor ? (
                    <Avatar user={actor} size="sm" />
                  ) : (
                    <span className={styles.iconOnly}>
                      <Icon size={16} strokeWidth={2.1} />
                    </span>
                  )}
                  {actor ? (
                    <span className={styles.kindBadge} aria-hidden="true">
                      <Icon size={11} strokeWidth={2.6} />
                    </span>
                  ) : null}
                </span>
                <span className={styles.text}>
                  <span className={styles.message}>{row.text}</span>
                  <span className={styles.when}>{timeAgo(row.createdAt)}</span>
                </span>
                {row.readAt ? null : <span className={styles.dot} aria-label="Unread" />}
              </>
            )

            return (
              <li key={row.id} className={row.readAt ? styles.item : `${styles.item} ${styles.unread}`}>
                {row.href ? (
                  <Link
                    to={row.href}
                    className={styles.row}
                    onClick={() => guard(() => notificationService.markRead(user.id, row.id))}
                  >
                    {body}
                  </Link>
                ) : (
                  <button
                    className={styles.row}
                    onClick={() => guard(() => notificationService.markRead(user.id, row.id))}
                  >
                    {body}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles.note}>
        Mentions are generated as they happen. Reactions, comments and reminders are seeded
        examples for now — live delivery arrives with the backend.
      </p>
    </div>
  )
}
