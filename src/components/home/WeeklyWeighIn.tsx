import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Scale } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, weightService } from '@/services'
import { weighInComparison } from '@/utils/progress'
import { formatDay, fromDateKey, todayKey } from '@/utils/date'
import { nextWeighInDate } from '@/utils/weighIn'
import { num, signed } from '@/utils/format'
import { goalProfile } from '@/utils/goals'
import styles from './WeeklyWeighIn.module.css'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The weekly weigh-in, given the room it deserves.
 *
 * Weight is the number this group actually reports to each other, so it is a
 * headline card rather than a row in a list. It has three states: it is
 * weigh-in day and you have not done it, you have just done it (and can choose
 * whether to tell anyone), or it is some other day and this is just a reminder.
 */
export function WeeklyWeighIn() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const today = todayKey()

  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  /** Set after saving so the share prompt appears once, not on every visit. */
  const [justSaved, setJustSaved] = useState(false)

  const entries = useLiveQuery(
    () => (user ? weightService.listForUser(user.id) : undefined),
    [user?.id],
  )
  const shared = useLiveQuery(
    () => (user ? weightService.isShared(user.id, today) : undefined),
    [user?.id, today],
  )

  useEffect(() => {
    setJustSaved(false)
  }, [today])

  if (!user || entries === undefined) return null

  const comparison = weighInComparison(entries, today)
  const done = Boolean(comparison.thisWeek)
  const isWeighInDay = fromDateKey(today).getDay() === user.weighInDay
  const dayName = DAY_NAMES[user.weighInDay]
  // The actual date, not just the weekday: the schedule runs every seven days
  // from here, and naming the day alone leaves the reader to work out which one.
  const nextDate = nextWeighInDate(user.weighInDay, today)
  const direction = goalProfile(user.goal).direction

  const save = async () => {
    const weightKg = Number(value)
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
      show('That weight looks off.', 'error')
      return
    }
    setSaving(true)
    const result = await guard(async () => {
      // Saved privately: whether the group hears about it is the next question,
      // not a side effect of writing it down.
      await weightService.add({ userId: user.id, date: today, weightKg, kind: 'official', announce: false })
      await achievementService.evaluate(user.id)
    })
    setSaving(false)
    if (result !== undefined) {
      setValue('')
      setJustSaved(true)
      show('Weigh-in saved.', 'success')
    }
  }

  const share = async () => {
    const result = await guard(() => weightService.shareWeighIn(user.id, today))
    if (result) {
      show('Posted to the group.', 'success')
      setJustSaved(false)
    }
  }

  // --- Done: the result, and a one-time offer to share it ------------------
  if (done) {
    const { thisWeek, changeKg } = comparison
    return (
      <section className={`glass ${styles.card} ${styles.doneCard}`} aria-labelledby="weighin-title">
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
            <span className="tnum">{num(thisWeek!.weightKg, 1)}</span>
            <span className={styles.unit}>kg</span>
          </p>
          {changeKg === undefined ? (
            <p className={styles.sub}>Your first weigh-in. Next week has something to compare to.</p>
          ) : (
            <p
              className={[
                styles.change,
                changeKg === 0
                  ? ''
                  : (direction === 'up') === changeKg > 0
                    ? styles.good
                    : styles.away,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="tnum">{signed(changeKg)} kg</span> this week
            </p>
          )}
        </div>

        {justSaved && !shared ? (
          <div className={styles.share}>
            <p className={styles.shareAsk}>Share with the group?</p>
            <div className={styles.shareRow}>
              <Button size="md" onClick={share}>
                Post update
              </Button>
              <Button variant="secondary" size="md" onClick={() => setJustSaved(false)}>
                Keep private
              </Button>
            </div>
          </div>
        ) : (
          <p className={styles.note}>
            {shared ? 'Shared with the group.' : `Next weigh-in ${dayName} ${formatDay(nextDate)}.`}
          </p>
        )}
      </section>
    )
  }

  // --- Not done ------------------------------------------------------------
  const last = comparison.lastWeek
  return (
    <section className={`glass ${styles.card}`} aria-labelledby="weighin-title">
      <header className={styles.head}>
        <span className={styles.badge}>
          <Scale size={15} strokeWidth={2.2} />
        </span>
        <h3 id="weighin-title" className={styles.title}>
          {isWeighInDay ? "It's weigh-in day ⚖️" : 'Weekly weigh-in'}
        </h3>
      </header>

      <p className={styles.sub}>
        {isWeighInDay
          ? "Let's see how the week went."
          : `Your weigh-in day is ${dayName} — but you can log it now.`}
      </p>

      <dl className={styles.facts}>
        <div>
          <dt>Last</dt>
          <dd className="tnum">{last ? `${num(last.weightKg, 1)} kg` : '—'}</dd>
        </div>
        {goalProfile(user.goal).usesTargetWeight ? (
          <div>
            <dt>Goal</dt>
            <dd className="tnum">{num(user.targetWeightKg, 1)} kg</dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.entry}>
        <Field
          label="This week"
          type="number"
          inputMode="decimal"
          suffix="kg"
          value={value}
          placeholder={last ? num(last.weightKg, 1) : '76.0'}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button size="lg" block onClick={save} disabled={saving || !value.trim()}>
          {saving ? 'Saving…' : 'Save weigh-in'}
        </Button>
      </div>
    </section>
  )
}
