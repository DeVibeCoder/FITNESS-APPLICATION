import { Card } from '@/components/ui/Card'
import type { FitnessGoal } from '@/models'
import type { WeeklyWeighIn } from '@/utils/weighIn'
import { formatDay } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { weeklyChangeNote, weeklyChangeSentiment } from '@/utils/goals'
import styles from './WeighInCard.module.css'

/**
 * This week's weigh-in, side by side with the one before it.
 *
 * Weighing is weekly, full stop — one number per seven-day cycle, anchored to
 * the day the person chose rather than to the calendar week. The change is
 * coloured by what it means for their goal: down is progress when cutting,
 * up is progress when gaining, and neither is anything at all when the goal is
 * to hold steady.
 */
export function WeighInCard({ status, goal }: { status: WeeklyWeighIn; goal: FitnessGoal }) {
  const { entry, previous, changeKg } = status
  const sentiment = weeklyChangeSentiment(goal, changeKg)

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <span className="eyebrow">Weekly weigh-in</span>
        <span className={styles.week}>{formatDay(status.slotDate)}</span>
      </div>

      <div className={styles.columns}>
        <div>
          <p className={styles.label}>This week</p>
          <p className={styles.value}>
            {entry ? (
              <>
                <span className="tnum">{num(entry.weightKg, 1)}</span>
                <span className={styles.unit}>kg</span>
              </>
            ) : (
              <span className={styles.pending}>Due</span>
            )}
          </p>
          {entry ? <p className={styles.when}>{formatDay(entry.date)}</p> : null}
        </div>

        <div>
          <p className={styles.label}>Previous</p>
          <p className={styles.value}>
            {previous ? (
              <>
                <span className="tnum">{num(previous.weightKg, 1)}</span>
                <span className={styles.unit}>kg</span>
              </>
            ) : (
              <span className={styles.pending}>—</span>
            )}
          </p>
          {previous ? <p className={styles.when}>{formatDay(previous.date)}</p> : null}
        </div>

        <div>
          <p className={styles.label}>Change</p>
          <p
            className={[
              styles.value,
              changeKg === undefined
                ? ''
                : sentiment === 'progress'
                  ? styles.toward
                  : sentiment === 'away'
                    ? styles.away
                    : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {changeKg === undefined ? (
              <span className={styles.pending}>—</span>
            ) : (
              <>
                <span className="tnum">{signed(changeKg)}</span>
                <span className={styles.unit}>kg</span>
              </>
            )}
          </p>
        </div>
      </div>

      <p className={styles.note}>
        {entry
          ? weeklyChangeNote(goal, changeKg)
          : `Log this week's weigh-in — next one ${formatDay(status.nextDate)}.`}
      </p>
    </Card>
  )
}
