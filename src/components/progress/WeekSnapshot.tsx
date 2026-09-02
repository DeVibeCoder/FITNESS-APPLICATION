import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/Progress'
import type { WeeklySummary } from '@/models'
import type { ConsistencyResult } from '@/utils/consistency'
import { consistencyTone } from '@/utils/consistency'
import { formatRange } from '@/utils/date'
import { num, signed } from '@/utils/format'
import styles from './WeekSnapshot.module.css'

/**
 * A compact read on the week in progress. Deliberately a snapshot and not a
 * review — the full weekly write-up is its own thing, later.
 */
export function WeekSnapshot({
  week,
  consistency,
}: {
  week: WeeklySummary
  consistency: ConsistencyResult
}) {
  const tone = consistencyTone(consistency.score)

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <span className={styles.range}>{formatRange(week.weekStart, week.weekEnd)}</span>
        <span className={styles.tone}>{tone.label}</span>
      </div>

      <dl className={styles.stats}>
        <div>
          <dd
            className={[
              styles.value,
              week.weightChangeKg === undefined
                ? styles.flat
                : week.weightChangeKg < 0
                  ? styles.down
                  : week.weightChangeKg > 0
                    ? styles.up
                    : styles.flat,
            ].join(' ')}
          >
            <span className="tnum">
              {week.weightChangeKg === undefined ? '—' : `${signed(week.weightChangeKg)}`}
            </span>
            {week.weightChangeKg === undefined ? '' : ' kg'}
          </dd>
          <dt>Weight</dt>
        </div>
        <div>
          <dd className={styles.value}>
            <span className="tnum">{week.workouts}</span>
            <span className={styles.of}>/{week.workoutGoal}</span>
          </dd>
          <dt>Workouts</dt>
        </div>
        <div>
          <dd className={styles.value}>
            <span className="tnum">{num(week.steps)}</span>
          </dd>
          <dt>Steps</dt>
        </div>
        <div>
          <dd className={styles.value}>
            <span className="tnum">{consistency.score}%</span>
          </dd>
          <dt>Consistency</dt>
        </div>
      </dl>

      <div className={styles.parts}>
        {consistency.parts.map((part) => (
          <div key={part.label}>
            <div className={styles.partHead}>
              <span>{part.label}</span>
              <span className="tnum">
                {part.done} / {part.total}
              </span>
            </div>
            <ProgressBar
              value={part.pct}
              max={100}
              size="sm"
              tone={part.pct >= 100 ? 'success' : 'accent'}
              label={part.label}
            />
          </div>
        ))}
      </div>

      <p className={styles.note}>{tone.note}</p>
    </Card>
  )
}
