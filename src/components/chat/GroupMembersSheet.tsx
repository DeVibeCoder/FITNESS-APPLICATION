import { useLiveQuery } from 'dexie-react-hooks'
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
 * were here without saying which three. Tapping it now opens this: name, goal
 * and, when it matters, whether someone is still waiting to be approved.
 *
 * Deliberately thin. No weight, no calories, no streaks, no consistency — a
 * chat header is not the place to publish anyone's numbers, and Group already
 * has a screen for the ones the group does share. What is here is only what a
 * person picked as their focus.
 */
export function GroupMembersSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()

  // Everyone with a live account, so somebody waiting on approval appears as
  // pending rather than quietly not existing.
  const members = useLiveQuery(
    async () => (await userService.list()).filter((u) => (u.status ?? 'approved') !== 'rejected'),
    [],
  )

  const rows = members ?? []
  const approved = rows.filter((member) => (member.status ?? 'approved') === 'approved')

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Group members"
      subtitle={`${approved.length} ${approved.length === 1 ? 'person' : 'people'} in this chat`}
    >
      <ul className={styles.list}>
        {rows.map((member) => {
          const pending = (member.status ?? 'approved') === 'pending'
          return (
            <li key={member.id} className={styles.item}>
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
              <span className={[styles.state, pending ? styles.pending : ''].filter(Boolean).join(' ')}>
                {pending ? 'Pending' : goalProfile(member.goal).direction === 'up' ? 'Building' : goalProfile(member.goal).direction === 'down' ? 'Cutting' : 'Holding'}
              </span>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
