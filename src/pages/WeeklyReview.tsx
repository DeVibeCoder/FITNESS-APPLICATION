import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowRight, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, Section } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/Progress'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { progressService } from '@/services'
import { reviewService } from '@/services/reviewService'
import { comparisonRows, reviewLines, NO_COMPARISON, NOTHING_YET } from '@/utils/review'
import { consistencyTone } from '@/utils/consistency'
import { addDays, formatRange, startOfWeek, todayKey, weekdayLabel } from '@/utils/date'
import { duration, litres, num, signed } from '@/utils/format'
import styles from './WeeklyReview.module.css'

export function WeeklyReview() {
  const { user } = useAuth()
  const today = todayKey()
  const [weekOf, setWeekOf] = useState(today)

  const review = useLiveQuery(
    () => (user ? reviewService.weeklyReview(user.id, weekOf) : undefined),
    [user?.id, weekOf],
  )
  const comparison = useLiveQuery(
    () => (user ? reviewService.comparison(user.id, weekOf) : undefined),
    [user?.id, weekOf],
  )
  const me = useLiveQuery(
    () => (user ? progressService.userSnapshot(user.id, weekOf) : undefined),
    [user?.id, weekOf],
  )

  if (!user || !review || !me) return <LoadingScreen />

  const isThisWeek = startOfWeek(weekOf) === startOfWeek(today)
  const empty =
    review.workouts === 0 && review.steps === 0 && review.nutritionDays === 0 && review.checkinDays === 0
  const lines = reviewLines(review, me.progress, { isCurrentWeek: isThisWeek })
  const tone = consistencyTone(review.consistency.score)

  return (
    <div className={styles.page}>
      <PageHeader title="Weekly review" subtitle={isThisWeek ? 'This week' : 'A previous week'} backTo="/activity" />

      <div className={styles.weekNav}>
        <button onClick={() => setWeekOf(addDays(startOfWeek(weekOf), -1))} aria-label="Previous week">
          <ChevronLeft size={16} strokeWidth={2.4} />
        </button>
        <span className={styles.range}>{formatRange(review.weekStart, review.weekEnd)}</span>
        <button
          onClick={() => setWeekOf(addDays(startOfWeek(weekOf), 7))}
          disabled={isThisWeek}
          aria-label="Next week"
        >
          <ChevronRight size={16} strokeWidth={2.4} />
        </button>
      </div>

      {empty ? (
        <EmptyState title="Nothing logged this week" body={NOTHING_YET} />
      ) : (
        <>
          <Section title="The week">
            <Card className={styles.headline}>
              <div className={styles.headlineTop}>
                <div>
                  <p className={styles.score}>
                    <span className="tnum">{review.consistency.score}%</span>
                  </p>
                  <p className={styles.tone}>{tone.label}</p>
                </div>
                <div className={styles.weightBox}>
                  <span
                    className={[
                      styles.weight,
                      review.weightChangeKg === undefined
                        ? styles.flat
                        : review.weightChangeKg < 0
                          ? styles.down
                          : styles.up,
                    ].join(' ')}
                  >
                    <span className="tnum">
                      {review.weightChangeKg === undefined
                        ? '—'
                        : `${signed(review.weightChangeKg)} kg`}
                    </span>
                  </span>
                  <span className={styles.weightLabel}>Weight</span>
                </div>
              </div>
              <p className={styles.toneNote}>{tone.note}</p>
            </Card>
          </Section>

          <Section title="What you did">
            <Card flush>
              <dl className={styles.stats}>
                <div>
                  <dt>Workouts</dt>
                  <dd className="tnum">
                    {review.workouts}
                    <span className={styles.of}>/{review.workoutGoal}</span>
                  </dd>
                </div>
                <div>
                  <dt>Training time</dt>
                  <dd className="tnum">{duration(review.durationSec)}</dd>
                </div>
                <div>
                  <dt>Est. burned</dt>
                  <dd className="tnum">{num(review.caloriesBurned)}</dd>
                </div>
                <div>
                  <dt>Steps</dt>
                  <dd className="tnum">{num(review.steps)}</dd>
                </div>
                <div>
                  <dt>Avg steps/day</dt>
                  <dd className="tnum">{num(review.avgStepsPerDay)}</dd>
                </div>
                <div>
                  <dt>Nutrition days</dt>
                  <dd className="tnum">
                    {review.nutritionDays}
                    <span className={styles.of}>/{review.daysElapsed}</span>
                  </dd>
                </div>
                <div>
                  <dt>Avg calories</dt>
                  <dd className="tnum">
                    {review.avgCalories === undefined ? '—' : num(review.avgCalories)}
                  </dd>
                </div>
                <div>
                  <dt>Water</dt>
                  <dd className="tnum">{litres(review.waterMl)} L</dd>
                </div>
                <div>
                  <dt>Best day</dt>
                  <dd className={styles.bestDay}>
                    {review.bestDay ? weekdayLabel(review.bestDay.date) : '—'}
                  </dd>
                </div>
              </dl>
            </Card>
          </Section>

          <Section title="Consistency">
            <Card className={styles.parts}>
              {review.consistency.parts.map((part) => (
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
            </Card>
          </Section>

          <Section title="Compared with last week">
            {comparison?.available ? (
              <Card flush>
                <ul className={styles.comparison}>
                  {comparisonRows(comparison, me.progress).map((row) => (
                    <li key={row.label}>
                      <span className={styles.compLabel}>{row.label}</span>
                      <span
                        className={[
                          styles.compValue,
                          row.direction === 'flat'
                            ? styles.flat
                            : row.favourable
                              ? styles.good
                              : styles.neutral,
                        ].join(' ')}
                      >
                        {row.direction === 'up' ? (
                          <ArrowUp size={13} strokeWidth={2.6} />
                        ) : row.direction === 'down' ? (
                          <ArrowDown size={13} strokeWidth={2.6} />
                        ) : (
                          <ArrowRight size={13} strokeWidth={2.6} />
                        )}
                        {row.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState compact title="Not enough history yet" body={NO_COMPARISON} />
            )}
          </Section>

          {lines.length > 0 ? (
            <Section title="In short">
              <Card flush>
                <ul className={styles.lines}>
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </div>
  )
}
