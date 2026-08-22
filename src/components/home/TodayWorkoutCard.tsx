import { Link } from 'react-router-dom'
import { Check, Dumbbell, Plus } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { CardPhoto } from '@/components/ui/CardPhoto'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import { workoutAppLabel } from '@/data/workoutApps'
import type { DailySnapshot } from '@/services/progressService'
import { duration, kcal } from '@/utils/format'
import { doneLine } from '@/data/messages'
import styles from './TodayWorkoutCard.module.css'

function feelingLabel(value?: string): string | null {
  return DIFFICULTY_OPTIONS.find((option) => option.value === value)?.label ?? null
}

/**
 * Today's workout, from wherever it was actually done.
 *
 * Circuit does not run the session — Home Workout and Lose Weight for Men do
 * that. So the empty state offers to record one rather than to start one, and
 * the finished state reads back exactly what the other app reported.
 *
 * The photograph is the same one in both themes, and it is presentation only:
 * nothing about it is stored, and if it fails to load — offline, most likely —
 * it removes itself and the card keeps the gradient underneath. See
 * `CardPhoto`.
 */
export function TodayWorkoutCard({
  snapshot,
  onLog,
}: {
  snapshot: DailySnapshot
  onLog: () => void
}) {
  const done = snapshot.completedSessions

  if (done.length === 0) {
    return (
      <section className={`onPhoto ${styles.card} ${styles.empty}`}>
        <CardPhoto image="workout" />
        <span className={styles.emptyIcon}>
          <Dumbbell size={19} strokeWidth={1.9} />
        </span>
        <div className={styles.emptyText}>
          <p className={styles.emptyTitle}>No workout logged yet</p>
          <p className={styles.emptyBody}>
            Trained in another app? Add a screenshot of its summary and we'll fill in what we
            can.
          </p>
        </div>
        <Button
          size="lg"
          block
          className={styles.logButton}
          icon={<Plus size={17} strokeWidth={2.6} />}
          onClick={onLog}
        >
          Log workout
        </Button>
      </section>
    )
  }

  const total = done.reduce(
    (sum, session) => ({
      sec: sum.sec + session.durationSec,
      kcal: sum.kcal + session.caloriesKcal,
      exercises: sum.exercises + session.exerciseCount,
    }),
    { sec: 0, kcal: 0, exercises: 0 },
  )
  const first = done[0]
  const feeling = feelingLabel(first.difficulty)

  return (
    <section className={`onPhoto ${styles.card} ${styles.done}`}>
      <CardPhoto image="workout" />
      <header className={styles.head}>
        <span className={styles.check}>
          <Check size={15} strokeWidth={3} />
        </span>
        <div className={styles.headText}>
          <p className={styles.app}>{workoutAppLabel(first.source, first.sourceName)}</p>
          <p className={styles.name}>
            {first.planName || first.name}
            {done.length > 1 ? ` +${done.length - 1} more` : ''}
          </p>
          {first.dayNumber ? <p className={styles.day}>Day {first.dayNumber}</p> : null}
        </div>
      </header>

      <dl className={styles.stats}>
        <div>
          <dt>Time</dt>
          <dd className="tnum">{duration(total.sec)}</dd>
        </div>
        <div>
          <dt>Burned</dt>
          <dd className="tnum">{kcal(total.kcal, 0)}</dd>
        </div>
        <div>
          <dt>Exercises</dt>
          <dd className="tnum">{total.exercises}</dd>
        </div>
        {feeling ? (
          <div>
            <dt>Felt</dt>
            <dd>{feeling}</dd>
          </div>
        ) : null}
      </dl>

      <p className={styles.line}>{doneLine(first.id)}</p>

      <div className={styles.actions}>
        <ButtonLink to="/workout/logs" variant="secondary" size="md" block>
          View update
        </ButtonLink>
        <Link to="/workout" className={styles.link}>
          Workout
        </Link>
      </div>
    </section>
  )
}
