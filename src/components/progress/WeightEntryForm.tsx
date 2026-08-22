import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, weightService } from '@/services'
import type { WeightEntry } from '@/models'
import { todayKey } from '@/utils/date'
import styles from './WeightEntryForm.module.css'

interface WeightEntryFormProps {
  /** Editing an existing record rather than adding a new one. */
  entry?: WeightEntry
  onDone: () => void
}

/**
 * The one weight form in the app. Used by the quick-log sheet and by the
 * history editor, so adding and correcting a weigh-in behave identically.
 */
export function WeightEntryForm({ entry, onDone }: WeightEntryFormProps) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const editing = Boolean(entry)

  /*
   * New entries are always the weekly official one — weighing is weekly here,
   * and the Official/Daily switch that used to sit at the top of this form was
   * asking a question the product no longer poses.
   *
   * Editing keeps whatever the stored row says. Some existing records are
   * daily, and silently promoting one to official would change a past week's
   * reported number without anybody asking for it.
   */
  const kind: WeightEntry['kind'] = entry?.kind ?? 'official'
  const [value, setValue] = useState(entry ? entry.weightKg.toFixed(1) : '')
  const [date, setDate] = useState(entry?.date ?? todayKey())
  const [note, setNote] = useState(entry?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const latest = useLiveQuery(
    () => (user && !editing ? weightService.latest(user.id) : undefined),
    [user?.id, editing],
  )

  // A new entry starts from the last known weight — most people move a little,
  // not a lot, and typing 76.8 from scratch every time is friction.
  useEffect(() => {
    if (!editing && latest && value === '') setValue(latest.weightKg.toFixed(1))
  }, [latest, value, editing])

  if (!user) return null

  const save = async () => {
    const weightKg = Number.parseFloat(value)
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
      show('That weight looks off. Check the number.', 'error')
      return
    }
    setSaving(true)
    const result = await guard(async () => {
      if (entry) {
        await weightService.update(entry.id, {
          weightKg: Math.round(weightKg * 10) / 10,
          date,
          kind,
          note: note.trim() || undefined,
        })
      } else {
        await weightService.add({
          userId: user.id,
          date,
          weightKg,
          kind,
          note: note.trim() || undefined,
        })
      }
      await achievementService.evaluate(user.id)
    })
    setSaving(false)
    if (result !== undefined) {
      show(editing ? 'Weigh-in updated.' : 'Weigh-in saved.', 'success')
      onDone()
    }
  }

  const remove = async () => {
    if (!entry) return
    setSaving(true)
    const result = await guard(() => weightService.remove(entry.id))
    setSaving(false)
    if (result !== undefined) {
      show('Weigh-in deleted.')
      onDone()
    }
  }

  return (
    <>
      <Field
        label="Weight"
        type="number"
        inputMode="decimal"
        step="0.1"
        suffix="kg"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        hint={
          kind === 'official'
            ? 'This is the one the group compares each week.'
            : 'An older daily reading. It stays out of the weekly comparison.'
        }
      />
      <Field
        label="Date"
        type="date"
        value={date}
        max={todayKey()}
        onChange={(event) => setDate(event.target.value)}
      />
      <Field
        label="Note"
        value={note}
        placeholder="Optional — how the week went"
        maxLength={140}
        onChange={(event) => setNote(event.target.value)}
      />

      <Button size="lg" block onClick={save} disabled={saving}>
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
