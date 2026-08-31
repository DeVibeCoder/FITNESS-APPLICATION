import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/context/AuthContext'
import { userService } from '@/services'
import { goalLabel } from '@/utils/calories'
import { goalProfile } from '@/utils/goals'
import styles from './GroupMembersSheet.module.css'

/**
 * Who is in this conversation.
 *
 * The row of faces at the top of Chat was decoration — it said three people
 * were here without saying which three. Tapping it now opens this: name, goal,
 * and a way through to the same member view Group uses, so "who is Samir and
 * how is he doing" can be answered without leaving the thread.
 *
 * The list itself stays thin. No weight, no calories, no streaks — a chat
 * header is not the place to publish anybody's numbers. The details behind a
 * row are the group's own member view, which is where those numbers already
 * live and where they are already governed.
 *
 * Only members appear. A request still waiting on a decision is not in this
 * room, and Admin is the screen where something can actually be done about it.
 */
export function GroupMembersSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  /** Opens one person's details. Omitted, the rows are not interactive. */
  onSelect?: (userId: string) => void
}) {
  const { user } = useAuth()
  const members = useLiveQuery(() => userService.listMembers(), [])

  const rows = members ?? []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Group members"
      subtitle={`${rows.length} ${rows.length === 1 ? 'person' : 'people'} in this chat`}
    >
      <ul className={styles.list}>
        {rows.map((member) => {
          const direction = goalProfile(member.goal).direction
          const body = (
            <>
              <Avatar user={member} size="md" />
              <div className={styles.text}>
                <p className={styles.name}>
                  {member.name}
                  {member.id === user?.id ? <span className={styles.you}>You</span> : null}
                </p>
                <p className={styles.focus}>
                  @{member.handle} · {goalLabel(member.goal)}
                </p>
              </div>
              <span className={styles.state}>
                {direction === 'up' ? 'Building' : direction === 'down' ? 'Cutting' : 'Holding'}
              </span>
              {onSelect ? (
                <ChevronRight size={16} strokeWidth={2} className={styles.chevron} />
              ) : null}
            </>
          )

          return (
            <li key={member.id}>
              {onSelect ? (
                <button
                  type="button"
                  className={`${styles.item} ${styles.itemButton}`}
                  onClick={() => onSelect(member.id)}
                  aria-haspopup="dialog"
                >
                  {body}
                </button>
              ) : (
                <div className={styles.item}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
