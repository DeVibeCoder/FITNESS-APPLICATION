import { Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import type { FoodEntry, MealSlot } from '@/models'
import { sumMacros } from '@/services/nutritionService'
import { num } from '@/utils/format'
import styles from './MealSection.module.css'

interface MealSectionProps {
  label: string
  meal: MealSlot
  entries: FoodEntry[]
  onAdd: (meal: MealSlot) => void
  onEdit: (entry: FoodEntry) => void
}

/**
 * One meal. Empty meals stay a single quiet line rather than a large card —
 * three empty boxes shouting at breakfast time is not a good morning.
 */
export function MealSection({ label, meal, entries, onAdd, onEdit }: MealSectionProps) {
  const totals = sumMacros(entries)

  return (
    <Card flush className={styles.card}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h3 className={styles.label}>{label}</h3>
          {entries.length > 0 ? (
            <p className={styles.macros}>
              <span className="tnum">{num(totals.proteinG)}</span> P ·{' '}
              <span className="tnum">{num(totals.carbsG)}</span> C ·{' '}
              <span className="tnum">{num(totals.fatG)}</span> F
            </p>
          ) : null}
        </div>
        {entries.length > 0 ? (
          <span className={styles.kcal}>
            <span className="tnum">{num(totals.kcal)}</span> kcal
          </span>
        ) : null}
        <button className={styles.add} onClick={() => onAdd(meal)} aria-label={`Add to ${label}`}>
          <Plus size={16} strokeWidth={2.6} />
        </button>
      </header>

      {entries.length === 0 ? (
        <p className={styles.empty}>Nothing logged yet.</p>
      ) : (
        <ul className={styles.items}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <button className={styles.item} onClick={() => onEdit(entry)}>
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{entry.name}</span>
                  <span className={styles.itemPortion}>
                    {entry.portion}
                    {entry.source === 'photo' ? (
                      <span className={styles.scanned}>Scanned</span>
                    ) : null}
                  </span>
                </span>
                <span className={styles.itemKcal}>
                  <span className="tnum">{num(entry.kcal)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
