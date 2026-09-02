import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, SelectField } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, nutritionService } from '@/services'
import { MEAL_SLOTS } from '@/services/nutritionService'
import type { FoodEntry, MealSlot } from '@/models'
import { FOOD_UNITS, formatPortion, macrosLookOff, type FoodUnit } from '@/utils/nutrition'
import { todayKey } from '@/utils/date'
import { suggestMeal } from '@/services/foodScanService'
import styles from './FoodEntryForm.module.css'

interface FoodEntryFormProps {
  entry?: FoodEntry
  /** Preselected meal when adding from a specific section. */
  meal?: MealSlot
  date?: string
  onDone: () => void
}

/**
 * The one food form. Used for adding from the quick-log sheet, adding from a
 * meal section, and correcting an existing entry — editing writes back to the
 * same record rather than creating a second one.
 */
export function FoodEntryForm({ entry, meal, date, onDone }: FoodEntryFormProps) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const editing = Boolean(entry)
  const forDate = entry?.date ?? date ?? todayKey()

  const [form, setForm] = useState({
    meal: entry?.meal ?? meal ?? suggestMeal(),
    name: entry?.name ?? '',
    quantity: entry?.quantity?.toString() ?? '',
    unit: (entry?.unit as FoodUnit) ?? 'g',
    kcal: entry?.kcal?.toString() ?? '',
    proteinG: entry?.proteinG?.toString() ?? '',
    carbsG: entry?.carbsG?.toString() ?? '',
    fatG: entry?.fatG?.toString() ?? '',
    note: entry?.note ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!user) return null

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const numeric = (value: string) => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }

  const macros = {
    kcal: Math.round(numeric(form.kcal)),
    proteinG: Math.round(numeric(form.proteinG)),
    carbsG: Math.round(numeric(form.carbsG)),
    fatG: Math.round(numeric(form.fatG)),
  }
  const mismatch = macrosLookOff(macros)

  const save = async () => {
    if (!form.name.trim()) {
      show('Give it a name so you recognise it later.', 'error')
      return
    }
    if (macros.kcal <= 0) {
      show('Add a calorie estimate.', 'error')
      return
    }

    const quantity = form.quantity ? numeric(form.quantity) : undefined
    const payload = {
      meal: form.meal,
      name: form.name.trim(),
      quantity,
      unit: quantity ? form.unit : undefined,
      portion: formatPortion(quantity, form.unit),
      note: form.note.trim() || undefined,
      ...macros,
    }

    setSaving(true)
    /*
     * `guard` reports failure as `undefined`, so a guarded action has to hand
     * back something to distinguish "it worked" from "it threw". Without the
     * `true` the form saved the food and then sat there, apparently ignoring
     * the button that had just worked.
     */
    const result = await guard(async () => {
      if (entry) {
        await nutritionService.updateFood(entry.id, payload)
      } else {
        await nutritionService.addFood({
          userId: user.id,
          date: forDate,
          source: 'manual',
          ...payload,
        })
      }
      // Days logged is one of the things the marks are counted from, the same
      // way a workout counts. Nutrition was writing rows nothing looked at.
      await achievementService.evaluate(user.id)
      return true
    })
    setSaving(false)
    if (result) {
      show(editing ? 'Entry updated.' : 'Added.', 'success')
      onDone()
    }
  }

  const remove = async () => {
    if (!entry) return
    setSaving(true)
    const result = await guard(async () => {
      await nutritionService.removeFood(entry.id)
      // Quietly: a mark that no longer stands is withdrawn, and nobody needs
      // an announcement about deleting a meal.
      await achievementService.evaluate(user.id, { announce: false })
      return true
    })
    setSaving(false)
    if (result) {
      show('Entry deleted.')
      onDone()
    }
  }

  return (
    <>
      <SelectField
        label="Meal"
        value={form.meal}
        onChange={(event) => set('meal', event.target.value as MealSlot)}
      >
        {MEAL_SLOTS.map((slot) => (
          <option key={slot.value} value={slot.value}>
            {slot.label}
          </option>
        ))}
      </SelectField>

      <Field
        label="What did you eat?"
        value={form.name}
        placeholder="Chicken breast"
        onChange={(event) => set('name', event.target.value)}
      />

      <div className={styles.portion}>
        <Field
          label="Quantity"
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="150"
          value={form.quantity}
          onChange={(event) => set('quantity', event.target.value)}
        />
        <SelectField
          label="Unit"
          value={form.unit}
          onChange={(event) => set('unit', event.target.value as FoodUnit)}
        >
          {FOOD_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </SelectField>
      </div>

      <Field
        label="Calories"
        type="number"
        inputMode="numeric"
        suffix="kcal"
        value={form.kcal}
        onChange={(event) => set('kcal', event.target.value)}
      />

      <div className={styles.macros}>
        <Field
          label="Protein"
          type="number"
          inputMode="numeric"
          suffix="g"
          value={form.proteinG}
          onChange={(event) => set('proteinG', event.target.value)}
        />
        <Field
          label="Carbs"
          type="number"
          inputMode="numeric"
          suffix="g"
          value={form.carbsG}
          onChange={(event) => set('carbsG', event.target.value)}
        />
        <Field
          label="Fat"
          type="number"
          inputMode="numeric"
          suffix="g"
          value={form.fatG}
          onChange={(event) => set('fatG', event.target.value)}
        />
      </div>

      {mismatch ? (
        <p className={styles.hint}>
          The macros don't quite add up to the calories. That's fine if it's what the label says —
          just worth a second look.
        </p>
      ) : null}

      <Field
        label="Note"
        value={form.note}
        placeholder="Optional"
        maxLength={140}
        onChange={(event) => set('note', event.target.value)}
      />

      <Button size="lg" block onClick={save} disabled={saving}>
        {saving
          ? 'Saving…'
          : editing
            ? 'Save changes'
            : `Add to ${MEAL_SLOTS.find((slot) => slot.value === form.meal)?.label.toLowerCase()}`}
      </Button>

      {editing ? (
        confirmDelete ? (
          <div className={styles.confirm}>
            <p className={styles.confirmText}>Delete this from your day? This cannot be undone.</p>
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
            Delete entry
          </Button>
        )
      ) : null}
    </>
  )
}
