import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, weightService } from '@/services'
import { isPlausibleWeight } from '@/services/weightService'
import type { DateKey, WeightEntry } from '@/models'
import { formatDay, todayKey } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { weeklyChangeNote, weeklyChangeSentiment } from '@/utils/goals'
import styles from './WeightEntryForm.module.css'

interface WeightEntryFormProps {
  /** Editing an existing weekly record rather than logging this week's. */
  entry?: WeightEntry
  onDone: () => void
}

/**
 * The one weigh-in form in the app. Used by the Create sheet and by the
 * history editor, so logging and correcting a week behave identically.
 *
 * Two fields: the weight, and an optional note. There is no date picker and no
 * Official/Daily switch — weighing is weekly, and the app already knows which
 * seven-day cycle today sits in. Asking the person to confirm a date they
 * cannot get wrong was a field that could only ever be answered incorrectly.
 *
 * Saving is private. The group is told only if the second step is answered
 * with Post update, and only once per week however many times the number is
 * corrected afterwards.
 */
export function WeightEntryForm({ entry, onDone }: WeightEntryFormProps) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const editing = Boolean(entry)

  const [value, setValue] = useState(entry ? entry.weightKg.toFixed(1) : '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Set once saved, which turns the form into the share question. */
  const [saved, setSaved] = useState<{ date: DateKey; weightKg: number; changeKg?: number } | null>(
    null,
  )

  const status = useLiveQuery(
    () => (user && !editing ? weightService.thisWeek(user.id) : undefined),
    [user?.id, editing],
  )

  // A new entry starts from the last known weight — most people move a little,
  // not a lot, and typing 76.8 from scratch every time is friction.
  useEffect(() => {
    if (editing || value !== '') return
    const seed = status?.entry ?? status?.previous
    if (seed) setValue(seed.weightKg.toFixed(1))
  }, [status, value, editing])

  if (!user) return null

  // --- Saved: the one question that follows ---------------------------------
  if (saved) {
    const sentiment = weeklyChangeSentiment(user.goal, saved.changeKg)
    return (
      <div className={styles.after}>
        <p className={styles.afterValue}>
          <span className="tnum">{num(saved.weightKg, 1)}</span> kg
          <span className={styles.afterDate}>{formatDay(saved.date)}</span>
        </p>
        {saved.changeKg === undefined ? null : (
          <p className={[styles.afterChange, styles[sentiment]].join(' ')}>
            <span className="tnum">{signed(saved.changeKg)} kg</span> this week
          </p>
        )}
        <p className={styles.afterNote}>{weeklyChangeNote(user.goal, saved.changeKg)}</p>

        <p className={styles.shareAsk}>Share this week's progress with the group?</p>
        <Button
          size="lg"
          block
          onClick={async () => {
            const posted = await guard(() => weightService.shareWeighIn(user.id, saved.date))
            if (posted) show('Posted to the group.', 'success')
            onDone()
          }}
        >
          Post update
        </Button>
        <Button variant="secondary" size="lg" block onClick={onDone}>
          Keep private
        </Button>
      </div>
    )
  }

  const save = async () => {
    const weightKg = Number.parseFloat(value)
    if (!isPlausibleWeight(weightKg)) {
      show('That weight looks off. Check the number.', 'error')
      return
    }
    setSaving(true)

    if (entry) {
      // Correcting a past week. Its date is already the week it belongs to, so
      // it is updated where it stands rather than moved into the current cycle.
      const result = await guard(async () => {
        await weightService.update(entry.id, {
          weightKg: Math.round(weightKg * 10) / 10,
          note: note.trim() || undefined,
        })
        await achievementService.evaluate(user.id)
        return true
      })
      setSaving(false)
      if (result) {
        show('Weigh-in updated.', 'success')
        onDone()
      }
      return
    }

    const result = await guard(async () => {
      const written = await weightService.weighIn({
        userId: user.id,
        weightKg,
        note: note.trim() || undefined,
      })
      await achievementService.evaluate(user.id)
      return written
    })
    setSaving(false)
    if (result === undefined) return

    show(result.created ? 'Weigh-in saved.' : "This week's weigh-in updated.", 'success')
    // Already told the group about this week? Then there is nothing to ask.
    if (await weightService.isShared(user.id, result.slotDate)) {
      onDone()
      return
    }
    setSaved({ date: result.slotDate, weightKg: result.entry.weightKg, changeKg: result.changeKg })
  }

  const remove = async () => {
    if (!entry) return
    setSaving(true)
    const result = await guard(async () => {
      await weightService.remove(entry.id)
      // What is left is what the marks are judged on, so they are re-read
      // rather than adjusted.
      await achievementService.evaluate(user.id, { announce: false })
      return true
    })
    setSaving(false)
    if (result) {
      show('Weigh-in deleted.')
      onDone()
    }
  }

  const weekDate = entry?.date ?? status?.slotDate ?? todayKey()
  const alreadyThisWeek = !editing && Boolean(status?.entry)

  return (
    <>
      <Field
        label="Weight"
        type="number"
        inputMode="decimal"
        step="0.1"
        suffix="kg"
        value={value}
        placeholder="76.0"
        onChange={(event) => setValue(event.target.value)}
        hint={
          editing
            ? `The week of ${formatDay(weekDate)}.`
            : alreadyThisWeek
              ? `Updates this week's weigh-in — ${formatDay(weekDate)}.`
              : `This week's weigh-in — ${formatDay(weekDate)}.`
        }
      />
      <Field
        label="Note"
        value={note}
        placeholder="Optional — how the week went"
        maxLength={140}
        onChange={(event) => setNote(event.target.value)}
      />

      <Button size="lg" block onClick={save} disabled={saving || !value.trim()}>
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Save weigh-in'}
      </Button>

      {editing ? (
        confirmDelete ? (
          <div className={styles.confirm}>
            <p className={styles.confirmText}>Delete this weigh-in? This cannot be undone.</p>
            <div className={styles.confirmRow}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
              <Button variant="danger" onClick={remove} disabled={saving}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            icon={<Trash2 size={15} strokeWidth={2.1} />}
            onClick={() => setConfirmDelete(true)}
          >
            Delete weigh-in
          </Button>
        )
      ) : null}
    </>
  )
}
