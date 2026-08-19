import { Card } from '@/components/ui/Card'
import type { Insight } from '@/utils/insights'
import { NOT_ENOUGH_DATA } from '@/utils/insights'
import styles from './Insights.module.css'

/**
 * Observations, not coaching. Each line is a fact read off the records; when
 * there aren't enough records to say anything true, it says so.
 */
export function Insights({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <Card className={styles.card}>
        <p className={styles.empty}>{NOT_ENOUGH_DATA}</p>
      </Card>
    )
  }

  return (
    <Card flush>
      <ul className={styles.list}>
        {insights.map((insight) => (
          <li key={insight.id} className={styles.item}>
            <span
              className={[styles.dot, insight.tone === 'good' ? styles.good : ''].join(' ')}
              aria-hidden="true"
            />
            {insight.text}
          </li>
        ))}
      </ul>
    </Card>
  )
}
