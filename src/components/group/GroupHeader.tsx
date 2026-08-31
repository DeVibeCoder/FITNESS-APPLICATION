import { useLiveQuery } from 'dexie-react-hooks'
import { Avatar } from '@/components/ui/Avatar'
import { CardPhoto } from '@/components/ui/CardPhoto'
import { useAuth } from '@/context/AuthContext'
import { chatService, progressService, userService } from '@/services'
import { todayKey } from '@/utils/date'
import { num } from '@/utils/format'
import { movementTowardGoal } from '@/utils/goals'
import styles from './GroupHeader.module.css'

/**
 * One header for the whole Group area.
 *
 * It is rendered by the Group layout, not by the pages, which is the point:
 * moving between Overview, Progress, Updates, Challenge and Awards changes the
 * content underneath and nothing else. Before this, each section had its own
 * title and its own back arrow, so five sibling views felt like five unrelated
 * screens you had to keep leaving Group to reach.
 */
export function GroupHeader() {
  const { user } = useAuth()
  const today = todayKey()

  const members = useLiveQuery(() => progressService.groupSnapshot(today), [today])
  // The group is the approved members and nothing else. This used to count
  // people awaiting approval too, so the header said "3 of 4" while every
  // total underneath it was over three — one screen answering "how many of us
  // are there" two different ways. Requests live in Admin, which is where a
  // decision can actually be made about them.
  const users = useLiveQuery(() => userService.listMembers(), [])
  // Chat lives in its own tab now. This is the one trace of it here: a count,
  // not a card, and not a way in — §6 is explicit that Group is not messaging.
  const summary = useLiveQuery(() => (user ? chatService.summary(user.id) : undefined), [user?.id])

  const week = (members ?? []).reduce(
    (totals, member) => ({
      workouts: totals.workouts + member.workoutsThisWeek,
      steps: totals.steps + member.stepsThisWeek,
      // Distance travelled toward each person's own goal, added up. Someone
      // gaining on purpose contributes the same as someone cutting.
      movedKg: totals.movedKg + Math.max(0, movementTowardGoal(member.user, member.currentWeightKg)),
    }),
    { workouts: 0, steps: 0, movedKg: 0 },
  )

  const active = users?.length ?? 0

  return (
    <header className={`onPhoto ${styles.header}`}>
      <CardPhoto image="group" />
      <p className="eyebrow">Our fitness group</p>
      <h1 className={styles.title}>{active} people</h1>

      <div className={styles.faces}>
        {(users ?? []).map((member) => (
          <span key={member.id} className={styles.face}>
            <Avatar user={member} size="sm" />
          </span>
        ))}
      </div>

      <dl className={styles.week}>
        <div>
          <dt>Workouts</dt>
          <dd className="tnum">{week.workouts}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd className="tnum">{num(week.steps)}</dd>
        </div>
        <div>
          <dt>Progress</dt>
          <dd className="tnum">{num(Math.round(week.movedKg * 10) / 10, 1)} kg</dd>
        </div>
      </dl>

      <p className={styles.meta}>
        This week
        {summary && summary.unread > 0 ? (
          <>
            {' · '}
            <span className={styles.unread}>{summary.unread} unread in chat</span>
          </>
        ) : null}
      </p>
    </header>
  )
}
