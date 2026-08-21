import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { chatService, userService } from '@/services'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './ChatHome.module.css'

/** What a share reads as when previewed rather than shown. */
const SHARED_LABEL: Record<string, string> = {
  workout: 'Shared a workout',
  weigh_in: 'Shared a weigh-in',
  steps: 'Shared their steps',
  achievement: 'Shared an achievement',
  challenge: 'Shared the challenge',
}

/**
 * The Chat tab.
 *
 * There is exactly one conversation, so this could have been a redirect. It is
 * not, for two reasons: it is where missed messages are stated plainly before
 * you commit to reading them, and a tab that teleports somewhere else leaves
 * you with no idea where "back" goes.
 *
 * It is one room, presented as one room — a hero, not a list of one.
 */
export function ChatHome() {
  const { user } = useAuth()

  const summary = useLiveQuery(() => (user ? chatService.summary(user.id) : undefined), [user?.id])
  const users = useLiveQuery(() => userService.listMembers(), [])
  const everyone = useLiveQuery(
    async () => (await userService.list()).filter((u) => (u.status ?? 'approved') !== 'rejected'),
    [],
  )

  if (!user || !summary || !users) return <LoadingScreen />

  const byId = new Map(users.map((u) => [u.id, u]))
  const author = summary.latestAuthorId ? byId.get(summary.latestAuthorId) : undefined
  const preview = summary.latest
    ? summary.latest.text || SHARED_LABEL[summary.latest.sharedType ?? ''] || 'Shared progress'
    : null

  const active = users.length
  const total = everyone?.length ?? active
  const unread = summary.unread

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Chat</h1>

      <Link
        to="/chat/thread"
        className={`glass ${styles.room} ${unread > 0 ? styles.roomUnread : ''}`}
      >
        <p className="eyebrow">Group chat</p>

        <div className={styles.top}>
          <div className={styles.identity}>
            <span className={styles.name}>Fitness group</span>
            <span className={styles.people}>
              {total > active ? `${active} of ${total} people` : `${active} people`}
            </span>
          </div>
          {unread > 0 ? (
            <span className={styles.unread}>
              {unread > 99 ? '99+' : unread}
              <span className="sr-only"> unread messages</span>
            </span>
          ) : null}
        </div>

        <span className={styles.faces}>
          {users.slice(0, 4).map((member) => (
            <span key={member.id} className={styles.face}>
              <Avatar user={member} size="sm" />
            </span>
          ))}
        </span>

        {/*
          The last thing said, attributed and timed. Quoted rather than
          paraphrased — the point of a preview is deciding whether to open it.
        */}
        <div className={styles.message}>
          {summary.latest && author ? (
            <>
              <p className={styles.author}>{firstName(author.name)}</p>
              <p className={styles.line}>{preview}</p>
              <p className={styles.when}>{timeAgo(summary.latest.createdAt)}</p>
            </>
          ) : (
            <>
              <p className={styles.author}>No messages yet</p>
              <p className={styles.line}>Be the first to check in.</p>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.status}>
            {unread > 0 ? (
              <>
                <span className={styles.dot} aria-hidden="true" />
                {unread} new
              </>
            ) : (
              'Up to date'
            )}
          </span>
          <span className={styles.open}>
            {unread > 0 ? 'Read messages' : 'Open chat'}
            <ArrowRight size={15} strokeWidth={2.4} />
          </span>
        </div>
      </Link>

      <p className={styles.note}>
        {unread > 0
          ? `You have ${unread} message${unread === 1 ? '' : 's'} to catch up on. Opening the chat takes you to the first one you missed.`
          : 'You are up to date. One room, the three of you — there are no direct messages here.'}
      </p>
    </div>
  )
}
