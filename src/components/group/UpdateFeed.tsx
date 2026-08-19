import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { updateService } from '@/services'
import { REACTION_EMOJI } from '@/services/updateService'
import type { UpdateWithReactions } from '@/services/updateService'
import type { User } from '@/models'
import { EMPTY } from '@/data/messages'
import { firstName } from '@/utils/format'
import { timeAgo } from '@/utils/date'
import styles from './UpdateFeed.module.css'

interface UpdateFeedProps {
  updates: UpdateWithReactions[]
  users: Map<string, User>
}

/** A short feed with three reactions. Deliberately not a comment thread. */
export function UpdateFeed({ updates, users }: UpdateFeedProps) {
  const { user } = useAuth()
  const { guard } = useToast()

  if (updates.length === 0) {
    return <EmptyState compact title={EMPTY.noUpdates.title} body={EMPTY.noUpdates.body} />
  }

  return (
    <ul className={styles.feed}>
      {updates.map((update) => {
        const author = users.get(update.userId)
        if (!author) return null
        const counts = new Map<string, number>()
        for (const reaction of update.reactions) {
          counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1)
        }
        const mine = update.reactions.find((r) => r.userId === user?.id)

        return (
          <li key={update.id} className={styles.item}>
            <Link
              to={author.id === user?.id ? '/profile' : `/u/${author.id}`}
              className={styles.avatar}
              aria-label={author.name}
            >
              <Avatar user={author} size="sm" />
            </Link>
            <div className={styles.body}>
              <p className={styles.text}>
                <span className={styles.author}>{firstName(author.name)}</span> {update.text}
              </p>
              <p className={styles.time}>{timeAgo(update.createdAt)}</p>
              <div className={styles.reactions}>
                {REACTION_EMOJI.map((emoji) => {
                  const count = counts.get(emoji) ?? 0
                  const active = mine?.emoji === emoji
                  if (count === 0 && !active && update.userId === user?.id) return null
                  return (
                    <button
                      key={emoji}
                      className={[styles.reaction, active ? styles.reactionActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() =>
                        user && guard(() => updateService.toggleReaction(update.id, user.id, emoji))
                      }
                      aria-pressed={active}
                      aria-label={`React with ${emoji}`}
                    >
                      <span aria-hidden="true">{emoji}</span>
                      {count > 0 ? <span className="tnum">{count}</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
