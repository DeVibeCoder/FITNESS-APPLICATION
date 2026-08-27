import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Scale } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CardPhoto } from '@/components/ui/CardPhoto'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { weightService } from '@/services'
import { formatDay, todayKey } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { goalProfile, weeklyChangeNote, weeklyChangeSentiment } from '@/utils/goals'
import styles from './WeeklyWeighIn.module.css'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * This week's weigh-in status.
 *
 * The whole point of the card is that the answer to "have I done it this week"
 * is legible at a glance, so it says one of exactly two things — due, or
 * complete — and never both. The form itself lives in the Create sheet, which
 * is the only place a weigh-in is ever typed; this used to carry its own copy
 * of the field, and two forms writing the same record is how a week ends up
 * with two numbers.
 *
 * The change is coloured by the person's goal, not by its sign. Someone
 * building muscle sees +0.6 kg as a good week; someone maintaining sees it as
 * neither.
 */
export function WeeklyWeighIn() {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const today = todayKey()

  const status = useLiveQuery(
    () => (user ? weightService.thisWeek(user.id, today) : undefined),
    [user?.id, today],
  )
  const shared = useLiveQuery(
    () => (user ? weightService.isShared(user.id, today) : undefined),
    [user?.id, today],
  )

  if (!user || !status) return null

  const dayName = DAY_NAMES[user.weighInDay]

  // --- Complete --------------------------------------------------------------
  if (status.done && status.entry) {
    const sentiment = weeklyChangeSentiment(user.goal, status.changeKg)
    return (
      <section className={`onPhoto ${styles.card} ${styles.doneCard}`} aria-labelledby="weighin-title">
        <CardPhoto image="weighIn" />
        <header className={styles.head}>
          <span className={`${styles.badge} ${styles.badgeDone}`}>
            <Check size={15} strokeWidth={3} />
          </span>
          <h3 id="weighin-title" className={styles.title}>
            Weekly weigh-in complete
          </h3>
        </header>

        <div className={styles.readout}>
          <p className={styles.big}>
            <span className="tnum">{num(status.entry.weightKg, 1)}</span>
            <span className={styles.unit}>kg</span>
          </p>
          {status.changeKg === undefined ? null : (
            <p
              className={[
                styles.change,
                sentiment === 'progress' ? styles.good : sentiment === 'away' ? styles.away : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="tnum">{signed(status.changeKg)} kg</span> this week
            </p>
          )}
        </div>

        <p className={styles.sub}>{weeklyChangeNote(user.goal, status.changeKg)}</p>

        <p className={styles.note}>
          {shared ? 'Shared with the group. ' : ''}
          Next weigh-in {dayName} {formatDay(status.nextDate)}.
        </p>

        <Button variant="secondary" size="md" onClick={() => open('weight')}>
          Edit this week
        </Button>
      </section>
    )
  }

  // --- Due -------------------------------------------------------------------
  const { previous } = status
  return (
    <section className={`onPhoto ${styles.card}`} aria-labelledby="weighin-title">
      <CardPhoto image="weighIn" />
      <header className={styles.head}>
        <span className={styles.badge}>
          <Scale size={15} strokeWidth={2.2} />
        </span>
        <h3 id="weighin-title" className={styles.title}>
          Weekly weigh-in due
        </h3>
      </header>

      <p className={styles.sub}>
        {previous
          ? `The week of ${formatDay(status.slotDate)}. Your day is ${dayName}.`
          : `Your first weigh-in. Log it and the week of ${formatDay(status.slotDate)} is on the board.`}
      </p>

      <dl className={styles.facts}>
        <div>
          <dt>Last</dt>
          {previous ? (
            <dd className="tnum">{num(previous.weightKg, 1)} kg</dd>
          ) : (
            <dd className={styles.factWord}>No weigh-in yet</dd>
          )}
        </div>
        {goalProfile(user.goal).usesTargetWeight ? (
          <div>
            <dt>Goal</dt>
            <dd className="tnum">{num(user.targetWeightKg, 1)} kg</dd>
          </div>
        ) : null}
      </dl>

      <Button size="lg" block onClick={() => open('weight')}>
        Log weigh-in
      </Button>
    </section>
  )
}
