import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { WeightEntryForm } from './WeightEntryForm'
import type { FitnessGoal, Weekday, WeightEntry } from '@/models'
import { weighInSchedule } from '@/utils/weighIn'
import { formatDay } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { weeklyChangeSentiment } from '@/utils/goals'
import styles from './WeightHistory.module.css'

/**
 * The weekly weigh-ins, newest first.
 *
 * Not a list of rows any more — a schedule. Every seven days from the user's
 * chosen weigh-in day is a slot, and each slot either has a reading or does
 * not, so a missed week reads as a missed week rather than as an absence
 * nobody notices. The dates are derived from the profile, so changing the
 * weigh-in day moves the whole column.
 *
 * There used to be All / Official / Daily filters here. Weighing is weekly and
 * there is nothing else to filter for: the app writes one number per seven-day
 * cycle, so the history is the schedule and the schedule is the history.
 */
export function WeightHistory({
  entries,
  weighInDay,
  goal,
}: {
  entries: WeightEntry[]
  weighInDay: Weekday
  /** Decides what a week's movement is worth. Down is not always good. */
  goal: FitnessGoal
}) {
  const [editing, setEditing] = useState<WeightEntry | null>(null)
  const [adding, setAdding] = useState(false)

  const slots = weighInSchedule(entries, weighInDay, { includeNext: true })
  const recorded = slots.filter((slot) => slot.entry).length

  return (
    <>
      <Card flush>
        <ul className={styles.list}>
          {slots.map((slot) => {
            const { entry, changeKg } = slot

            // Nothing to edit and nothing to show: an empty slot is a prompt.
            if (!entry) {
              return (
                <li key={slot.date}>
                  <div
                    className={[
                      styles.row,
                      styles.rowEmpty,
                      slot.current ? styles.rowCurrent : '',
                      slot.upcoming ? styles.rowUpcoming : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={styles.date}>{formatDay(slot.date)}</span>
                    <span className={styles.pending}>
                      {slot.upcoming ? 'Next weigh-in' : slot.current ? 'Due this week' : 'Not logged'}
                    </span>
                    {slot.current ? (
                      <button className={styles.log} onClick={() => setAdding(true)}>
                        <Plus size={13} strokeWidth={2.6} />
                        Log weigh-in
                      </button>
                    ) : (
                      <span className={styles.change} />
                    )}
                  </div>
                </li>
              )
            }

            return (
              <li key={slot.date}>
                <button
                  className={[styles.row, slot.current ? styles.rowCurrent : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setEditing(entry)}
                >
                  <span className={styles.date}>{formatDay(slot.date)}</span>
                  <span className={styles.main}>
                    <span className={styles.weight}>
                      <span className="tnum">{num(entry.weightKg, 1)}</span> kg
                    </span>
                    {entry.note ? <span className={styles.note}>{entry.note}</span> : null}
                  </span>
                  <span className={styles.right}>
                    <span
                      className={[styles.change, styles[weeklyChangeSentiment(goal, changeKg)]].join(
                        ' ',
                      )}
                    >
                      {changeKg === undefined ? '—' : `${signed(changeKg)} kg`}
                    </span>
                    <Pencil size={13} strokeWidth={2} className={styles.pencil} />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      <p className={styles.footnote}>
        {recorded === 0
          ? 'Your weigh-in day comes round every seven days. Log the first one and this fills in.'
          : 'One weigh-in a week, on your chosen day. Change the day in your profile and these dates follow it.'}
      </p>

      {recorded === 0 ? (
        <Button icon={<Plus size={16} strokeWidth={2.4} />} onClick={() => setAdding(true)}>
          Log weigh-in
        </Button>
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit weigh-in"
        subtitle="Correct or remove this record."
      >
        {editing ? <WeightEntryForm entry={editing} onDone={() => setEditing(null)} /> : null}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Log weigh-in">
        <WeightEntryForm onDone={() => setAdding(false)} />
      </Sheet>
    </>
  )
}
