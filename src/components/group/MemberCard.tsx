import { ChevronRight, Flame } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import type { FitnessGoal } from '@/models'
import type { UserSnapshot } from '@/services/progressService'
import type { AchievementView } from '@/services/achievementService'
import { goalLabel } from '@/utils/calories'
import { num, signed } from '@/utils/format'
import { goalProfile } from '@/utils/goals'
import styles from './MemberCard.module.css'

interface MemberCardProps {
  member: UserSnapshot
  isYou: boolean
  weeklyChangeKg?: number
  recentAchievement?: AchievementView
  /**
   * Opens this person's full progress over Group rather than navigating to a
   * page outside it. Group Progress is about the other people in the group;
   * reading one of them should not cost you the comparison you were making.
   */
  onOpen: () => void
}

/**
 * Colour for a week's weight change, read against that member's own goal.
 *
 * Samir is building muscle, so +0.4 kg is a good week and must not look the
 * same as someone drifting away from a weight-loss target. Someone holding
 * steady has no good direction, so neither one is praised.
 */
function weekTone(changeKg: number | undefined, goal: FitnessGoal): string {
  if (changeKg === undefined || changeKg === 0) return styles.flat
  const direction = goalProfile(goal).direction
  if (direction === 'steady') return styles.up
  const movedTowardGoal = direction === 'up' ? changeKg > 0 : changeKg < 0
  return movedTowardGoal ? styles.down : styles.up
}

/**
 * One member at a glance. Everything shown here is public within the group:
 * goal, weight, progress, training, steps, consistency, streak. Body metrics,
 * targets and anything from the food diary stay out.
 */
export function MemberCard({
  member,
  isYou,
  weeklyChangeKg,
  recentAchievement,
  onOpen,
}: MemberCardProps) {
  const { user, progress } = member

  return (
    <Card flush className={styles.card}>
      <button type="button" className={styles.head} onClick={onOpen}>
        <Avatar user={user} size="lg" ring={member.streak >= 7} />
        <div className={styles.headText}>
          <p className={styles.name}>
            {user.name}
            {isYou ? <span className={styles.you}>You</span> : null}
          </p>
          <p className={styles.goal}>{goalLabel(user.goal)}</p>
          {member.streak > 0 ? (
            <span className={styles.streak}>
              <Flame size={11} strokeWidth={2.5} />
              {member.streak} day streak
            </span>
          ) : null}
        </div>
        <ChevronRight size={17} strokeWidth={2} className={styles.chevron} />
      </button>

      <div className={styles.journey}>
        <div className={styles.journeyRow}>
          <span className={styles.journeyLabel}>
            <span className="tnum">{num(user.startWeightKg, 1)}</span> →{' '}
            <span className={styles.current}>
              <span className="tnum">{num(member.currentWeightKg, 1)}</span> kg
            </span>{' '}
            → <span className="tnum">{num(user.targetWeightKg, 1)}</span>
          </span>
          <span className={styles.pct}>
            <span className="tnum">{Math.round(progress.pct)}%</span> toward goal
          </span>
        </div>
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${progress.pct}%` }} />
        </div>
      </div>

      <dl className={styles.stats}>
        <div>
          <dt>This week</dt>
          {/*
            Which way is the good way depends on the member's own goal. Samir
            is building muscle, so +0.4 kg is a win and must not be coloured
            the same as someone drifting away from a weight-loss target.
          */}
          <dd className={weekTone(weeklyChangeKg, member.user.goal)}>
            <span className="tnum">
              {weeklyChangeKg === undefined ? '—' : `${signed(weeklyChangeKg)}`}
            </span>
            {weeklyChangeKg === undefined ? '' : ' kg'}
          </dd>
        </div>
        <div>
          <dt>Workouts</dt>
          <dd className="tnum">{member.workoutsThisWeek}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd className="tnum">{num(member.stepsThisWeek)}</dd>
        </div>
        <div>
          <dt>Consistency</dt>
          <dd className="tnum">{member.consistency.score}%</dd>
        </div>
      </dl>

      {recentAchievement ? (
        <p className={styles.achievement}>
          <span aria-hidden="true">{recentAchievement.icon}</span>
          {recentAchievement.title}
        </p>
      ) : null}
    </Card>
  )
}
