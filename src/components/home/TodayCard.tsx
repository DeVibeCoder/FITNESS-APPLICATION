import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Flame } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Ring } from '@/components/ui/Progress'
import type { DailySnapshot } from '@/services/progressService'
import { useLogSheet } from '@/context/LogSheetContext'
import { clamp, kcal, litres, num, signed } from '@/utils/format'
import styles from './TodayCard.module.css'

interface TodayCardProps {
  snapshot: DailySnapshot
  streak: number
  streakAtRisk: boolean
  /** Change since the starting weight, for the weight row. */
  changeKg: number
  /**
   * Home shows the four headline metrics in its own strip, so the per-metric
   * rows here would print them a second time. Progress still uses the full
   * card, where nothing above it duplicates them.
   */
  summaryOnly?: boolean
}

/**
 * The two-second answer to "where am I today?". A completion ring for the five
 * daily habits, then one line per metric. Deliberately thin: the cards below
 * carry the detail and the quick actions.
 */
export function TodayCard({ snapshot, streak, streakAtRisk, changeKg, summaryOnly }: TodayCardProps) {
  const { open } = useLogSheet()
  const { user } = snapshot
  const workoutDone = snapshot.completedSessions.length > 0
  const restDay = snapshot.scheduled?.isRestDay === true
  const burned = snapshot.completedSessions.reduce((sum, s) => sum + s.caloriesKcal, 0)

  return (
    <Card flush>
      <div className={styles.head}>
        <Ring value={snapshot.tasksDone} max={snapshot.tasksTotal} size={78} thickness={8}>
          <span className={styles.ringValue}>
            <span className="tnum">{snapshot.tasksDone}</span>
            <span className={styles.ringTotal}>/{snapshot.tasksTotal}</span>
          </span>
        </Ring>
        <div className={styles.headText}>
          <p className={styles.headline}>
            <span className="tnum">{snapshot.tasksDone}</span> of{' '}
            <span className="tnum">{snapshot.tasksTotal}</span> complete
          </p>
          <p className={styles.sub}>{encouragement(snapshot)}</p>
          {streak > 0 ? (
            <span
              className={[styles.streak, streakAtRisk ? styles.streakRisk : '']
                .filter(Boolean)
                .join(' ')}
            >
              <Flame size={13} strokeWidth={2.4} />
              {streak} day streak
              {streakAtRisk ? <span className={styles.riskNote}>· keep it going</span> : null}
            </span>
          ) : null}
        </div>
      </div>

      {summaryOnly ? null : (
      <ul className={styles.rows}>
        <MetricRow
          label="Workout"
          value={workoutDone ? 'Completed' : restDay ? 'Rest day' : 'Not yet'}
          detail={
            workoutDone
              ? `${kcal(burned, 0)} kcal burned`
              : restDay
                ? 'Scheduled rest'
                : (snapshot.scheduled?.planDay.name ?? 'No plan yet')
          }
          done={workoutDone || restDay}
          to="/workout"
        />
        <MetricRow
          label="Steps"
          value={num(snapshot.steps)}
          detail={`of ${num(user.stepGoal)}`}
          pct={ratio(snapshot.steps, user.stepGoal)}
          done={snapshot.steps >= user.stepGoal}
          onClick={() => open('steps')}
        />
        <MetricRow
          label="Calories"
          value={num(snapshot.nutrition.kcal)}
          detail={`of ${num(snapshot.energy.target)}`}
          pct={ratio(snapshot.nutrition.kcal, snapshot.energy.target)}
          done={snapshot.nutrition.kcal > 0}
          onClick={() => open('meal')}
        />
        <MetricRow
          label="Water"
          value={`${litres(snapshot.waterMl)} L`}
          detail={`of ${num(snapshot.waterGoalMl / 1000, 1)} L`}
          pct={ratio(snapshot.waterMl, snapshot.waterGoalMl)}
          done={snapshot.waterMl >= snapshot.waterGoalMl}
          onClick={() => open('water')}
        />
        <MetricRow
          label="Weight"
          value={snapshot.weightKg ? `${num(snapshot.weightKg, 1)} kg` : '—'}
          detail={
            snapshot.weightToday
              ? `${signed(changeKg)} kg since start`
              : 'Not logged today'
          }
          done={Boolean(snapshot.weightToday)}
          onClick={() => open('weight')}
        />
      </ul>
      )}
    </Card>
  )
}

function ratio(value: number, target: number): number {
  return target > 0 ? clamp((value / target) * 100, 0, 100) : 0
}

/** Encouraging, never scolding — and specific enough to act on. */
function encouragement(snapshot: DailySnapshot): string {
  const { tasksDone, tasksTotal } = snapshot
  if (tasksDone === tasksTotal) return 'Nice work. You showed up today.'
  if (tasksDone === tasksTotal - 1) return "You're almost there."
  if (tasksDone === 0) return 'Nothing logged yet. Start anywhere.'

  const missing: string[] = []
  if (snapshot.completedSessions.length === 0 && snapshot.scheduled?.isRestDay !== true)
    missing.push('workout')
  if (snapshot.steps < snapshot.stepGoal) missing.push('steps')
  if (snapshot.nutrition.kcal === 0) missing.push('food')
  if (snapshot.waterMl < snapshot.waterGoalMl) missing.push('water')
  if (!snapshot.checkIn) missing.push('check-in')
  if (missing.length === 0) return 'Good day so far.'
  if (missing.length === 1) return `Still to do: ${missing[0]}.`
  return `Still to do: ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`
}

interface MetricRowProps {
  label: string
  value: string
  detail: string
  /** Omit for metrics without a target, such as weight. */
  pct?: number
  done: boolean
  onClick?: () => void
  to?: string
}

function MetricRow({ label, value, detail, pct, done, onClick, to }: MetricRowProps) {
  const inner = (
    <>
      <span className={styles.rowLabel}>
        {label}
        {done ? (
          <span className={styles.check}>
            <Check size={9} strokeWidth={3.4} />
            <span className="sr-only">done</span>
          </span>
        ) : null}
      </span>
      <span className={styles.rowValue}>
        <span className="tnum">{value}</span>
        <span className={styles.rowDetail}>{detail}</span>
      </span>
      {pct === undefined ? null : (
        <span className={styles.track} aria-hidden="true">
          <span
            className={[styles.fill, done ? styles.fillDone : ''].filter(Boolean).join(' ')}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </>
  )

  const className = `${styles.row} ${pct === undefined ? styles.rowNoBar : ''}`
  const content: ReactNode = inner

  if (to) {
    return (
      <li>
        <Link to={to} className={className}>
          {content}
        </Link>
      </li>
    )
  }
  return (
    <li>
      <button className={className} onClick={onClick}>
        {content}
      </button>
    </li>
  )
}
