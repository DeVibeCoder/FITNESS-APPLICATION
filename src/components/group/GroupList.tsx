import { Link } from 'react-router-dom'
import { Flame } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import type { UserSnapshot } from '@/services/progressService'
import styles from './GroupList.module.css'

interface GroupListProps {
  members: UserSnapshot[]
  currentUserId: string
}

/**
 * Everyone's progress, side by side. Ordered by consistency rather than weight —
 * the group has different goals and the scale is not a leaderboard.
 */
export function GroupList({ members, currentUserId }: GroupListProps) {
  return (
    <ul className={styles.list}>
      {members.map((member) => (
        <li key={member.user.id}>
          <Link
            to={member.user.id === currentUserId ? '/profile' : `/u/${member.user.id}`}
            className={styles.row}
          >
            <Avatar user={member.user} size="md" ring={member.streak >= 7} />
            <div className={styles.text}>
              <span className={styles.name}>
                {member.user.name}
                {member.user.id === currentUserId ? <span className={styles.you}>You</span> : null}
              </span>
              {/*
                Progress toward each person's own goal, not raw kilograms: the
                group has different goals in different directions, and comparing
                the weight itself would be meaningless.
              */}
              <span className={styles.meta}>
                <span className={styles.goalPct}>
                  <span className="tnum">{Math.round(member.progress.pct)}%</span> toward goal
                </span>
              </span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${member.progress.pct}%` }} />
              </span>
            </div>
            <div className={styles.right}>
              {member.streak > 0 ? (
                <span className={styles.streak}>
                  <Flame size={12} strokeWidth={2.5} />
                  <span className="tnum">{member.streak}</span>
                </span>
              ) : null}
              <span className={styles.consistency}>
                <span className="tnum">{member.consistency.score}%</span> consistent
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
