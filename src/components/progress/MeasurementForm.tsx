import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { measurementService } from '@/services'
import { MEASUREMENT_FIELDS } from '@/services/measurementService'
import type { BodyMeasurement } from '@/models'
import { todayKey } from '@/utils/date'
import styles from './WeightEntryForm.module.css'

/**
 * Every field is optional — that is the point. People measure their waist and
 * nothing else, and the app should not nag them for the rest. Blank fields are
 * stored as absent rather than as zero, so nothing is invented.
 */
export function MeasurementForm({
  entry,
  onDone,
}: {
  entry?: BodyMeasurement
  onDone: () => void
}) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const editing = Boolean(entry)

  const [date, setDate] = useState(entry?.date ?? todayKey())
  const [values, setValues] = useState<Record<string, string>>(() => ({
    waistCm: entry?.waistCm?.toString() ?? '',
    chestCm: entry?.chestCm?.toString() ?? '',
    hipsCm: entry?.hipsCm?.toString() ?? '',
    armCm: entry?.armCm?.toString() ?? '',
    thighCm: entry?.thighCm?.toString() ?? '',
    bodyFatPct: entry?.bodyFatPct?.toString() ?? '',
  }))
  const [note, setNote] = useState(entry?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!user) return null

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  const parse = (key: string): number | undefined => {
    const raw = values[key]?.trim()
    if (!raw) return undefined
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10) / 10 : undefined
  }

  const save = async () => {
    const measurement = {
      waistCm: parse('waistCm'),
      chestCm: parse('chestCm'),
      hipsCm: parse('hipsCm'),
      armCm: parse('armCm'),
      thighCm: parse('thighCm'),
      bodyFatPct: parse('bodyFatPct'),
    }
    if (Object.values(measurement).every((value) => value === undefined)) {
      show('Fill in at least one measurement.', 'error')
      return
    }
    setSaving(true)
    const result = await guard(() =>
      measurementService.save({
        userId: user.id,
        date,
        note: note.trim() || undefined,
        ...measurement,
      }),
    )
    setSaving(false)
    if (result !== undefined) {
      show(editing ? 'Measurements updated.' : 'Measurements saved.', 'success')
      onDone()
    }
  }

  const remove = async () => {
    if (!entry) return
    setSaving(true)
    const result = await guard(() => measurementService.remove(entry.id))
    setSaving(false)
    if (result !== undefined) {
      show('Measurements deleted.')
      onDone()
    }
  }

  return (
    <>
      <Field
        label="Date"
        type="date"
        value={date}
        max={todayKey()}
        onChange={(event) => setDate(event.target.value)}
        hint="Saving twice on the same date updates that entry."
      />

      <div className={styles.grid}>
        {MEASUREMENT_FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            type="number"
            inputMode="decimal"
            step="0.1"
            suffix="cm"
            placeholder="—"
            value={values[field.key]}
            onChange={(event) => set(field.key, event.target.value)}
          />
        ))}
        <Field
          label="Body fat"
          type="number"
          inputMode="decimal"
          step="0.1"
          suffix="%"
          placeholder="—"
          value={values.bodyFatPct}
          onChange={(event) => set('bodyFatPct', event.target.value)}
        />
      </div>

      <Field
        label="Note"
        value={note}
        placeholder="Optional"
        maxLength={140}
        onChange={(event) => setNote(event.target.value)}
      />

      <Button size="lg" block onClick={save} disabled={saving}>
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Save measurements'}
      </Button>

      {editing ? (
        confirmDelete ? (
          <div className={styles.confirm}>
            <p className={styles.confirmText}>Delete this entry? This cannot be undone.</p>
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
            Delete this entry
          </Button>
        )
      ) : null}
    </>
  )
}
