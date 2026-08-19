import { Card } from '@/components/ui/Card'
import type { WeighInComparison } from '@/utils/progress'
import { formatDay } from '@/utils/date'
import { num, signed } from '@/utils/format'
import styles from './WeighInCard.module.css'

/**
 * The official weekly weigh-in, side by side with last week's. Daily readings
 * are deliberately absent: this is the number the group compares, and it should
 * not move because of a salty dinner.
 */
export function WeighInCard({ comparison }: { comparison: WeighInComparison }) {
  const { thisWeek, lastWeek, changeKg } = comparison

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <span className="eyebrow">Official weigh-in</span>
        <span className={styles.week}>Week {comparison.weekNumber}</span>
      </div>

      <div className={styles.columns}>
        <div>
          <p className={styles.label}>This week</p>
          <p className={styles.value}>
            {thisWeek ? (
              <>
                <span className="tnum">{num(thisWeek.weightKg, 1)}</span>
                <span className={styles.unit}>kg</span>
              </>
            ) : (
              <span className={styles.pending}>Not yet</span>
            )}
          </p>
          {thisWeek ? <p className={styles.when}>{formatDay(thisWeek.date)}</p> : null}
        </div>

        <div>
          <p className={styles.label}>Last week</p>
          <p className={styles.value}>
            {lastWeek ? (
              <>
                <span className="tnum">{num(lastWeek.weightKg, 1)}</span>
                <span className={styles.unit}>kg</span>
              </>
            ) : (
              <span className={styles.pending}>—</span>
            )}
          </p>
          {lastWeek ? <p className={styles.when}>{formatDay(lastWeek.date)}</p> : null}
        </div>

        <div>
          <p className={styles.label}>Change</p>
          <p
            className={[
              styles.value,
              changeKg === undefined ? '' : changeKg < 0 ? styles.down : changeKg > 0 ? styles.up : '',
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
        {thisWeek
          ? 'Daily entries are kept separate so they cannot skew the weekly result.'
          : 'Log an official weigh-in to update your week.'}
      </p>
    </Card>
  )
}
