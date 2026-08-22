import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { CalorieSummary } from '@/components/nutrition/CalorieSummary'
import { MealSection } from '@/components/nutrition/MealSection'
import { WaterCard } from '@/components/nutrition/WaterCard'
import { AddFoodSheet } from '@/components/nutrition/AddFoodSheet'
import { useAuth } from '@/context/AuthContext'
import { nutritionService, progressService } from '@/services'
import { MEAL_SLOTS } from '@/services/nutritionService'
import type { FoodEntry, MealSlot } from '@/models'
import { addDays, formatDay, lastNDays, todayKey, weekdayLabel } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './Nutrition.module.css'

/**
 * The nutrition day, as a page of Activity rather than a destination of its
 * own. The Activity tab stays lit while this is open, the header says which
 * section it belongs to, and back goes to Activity — the calories on that
 * screen and the meals on this one are the same subject at two depths.
 *
 * The same screen serves history: pick a different date and everything below
 * re-reads for that day, rather than maintaining a separate history page that
 * would drift from this one.
 */
export function Nutrition() {
  const { user } = useAuth()
  const today = todayKey()
  const [date, setDate] = useState(today)
  const [adding, setAdding] = useState<{ meal?: MealSlot; startIn?: 'choose' | 'scan' } | null>(null)
  const [editing, setEditing] = useState<FoodEntry | null>(null)

  const day = useLiveQuery(
    () => (user ? nutritionService.dayNutrition(user.id, date) : undefined),
    [user?.id, date],
  )
  const byMeal = useLiveQuery(
    () => (user ? nutritionService.byMeal(user.id, date) : undefined),
    [user?.id, date],
  )
  const energy = useLiveQuery(
    async () => (user ? progressService.energyPlan(user, await progressService.currentWeight(user.id)) : undefined),
    [user?.id, user?.heightCm, user?.goal, user?.activityLevel],
  )
  const strip = useLiveQuery(
    () => (user ? nutritionService.history(user.id, lastNDays(7, today)) : undefined),
    [user?.id, today],
  )

  if (!user || !day || !byMeal || !energy) return <LoadingScreen />

  const days = lastNDays(7, today)
  const isToday = date === today

  return (
    <div className={styles.page}>
      <PageHeader
        parent={{ label: 'Activity', to: '/activity' }}
        title="Nutrition"
        subtitle={isToday ? 'Today' : formatDay(date)}
        action={
          <Button
            size="sm"
            icon={<Camera size={15} strokeWidth={2.2} />}
            onClick={() => setAdding({ startIn: 'scan' })}
          >
            Scan
          </Button>
        }
      />

      <div className={styles.dates}>
        <button
          className={styles.arrow}
          onClick={() => setDate(addDays(date, -1))}
          aria-label="Previous day"
        >
          <ChevronLeft size={16} strokeWidth={2.4} />
        </button>
        <div className={styles.strip}>
          {days.map((option) => {
            const summary = strip?.[option]
            return (
              <button
                key={option}
                className={[styles.date, option === date ? styles.dateActive : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setDate(option)}
                aria-pressed={option === date}
              >
                <span className={styles.dateDay}>{weekdayLabel(option).slice(0, 1)}</span>
                <span className={styles.dateNum}>{option.slice(-2)}</span>
                <span
                  className={[styles.dot, (summary?.entries ?? 0) > 0 ? styles.dotOn : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>
        <button
          className={styles.arrow}
          onClick={() => setDate(addDays(date, 1))}
          disabled={isToday}
          aria-label="Next day"
        >
          <ChevronRight size={16} strokeWidth={2.4} />
        </button>
      </div>

      <Section title={isToday ? 'Today' : formatDay(date)}>
        <CalorieSummary totals={day.totals} energy={energy} />
      </Section>

      <Section
        title="Meals"
        action={
          <button className={styles.link} onClick={() => setAdding({})}>
            Add food
          </button>
        }
      >
        <div className={styles.meals}>
          {MEAL_SLOTS.map((slot) => (
            <MealSection
              key={slot.value}
              label={slot.label}
              meal={slot.value}
              entries={byMeal[slot.value]}
              onAdd={(meal) => setAdding({ meal })}
              onEdit={setEditing}
            />
          ))}
        </div>
      </Section>

      <Section title="Water">
        <WaterCard date={date} goalL={user.waterGoalL} />
      </Section>

      <Section title="Last 7 days">
        <ul className={styles.history}>
          {[...days].reverse().map((option) => {
            const summary = strip?.[option]
            return (
              <li key={option}>
                <button className={styles.historyRow} onClick={() => setDate(option)}>
                  <span className={styles.historyDate}>
                    {option === today ? 'Today' : formatDay(option)}
                  </span>
                  <span className={styles.historyStats}>
                    {summary && summary.entries > 0 ? (
                      <>
                        <span className={styles.historyKcal}>
                          <span className="tnum">{num(summary.kcal)}</span> kcal
                        </span>
                        <span className={styles.historyWater}>
                          <span className="tnum">{num(summary.waterMl / 1000, 1)}</span> L
                        </span>
                      </>
                    ) : (
                      <span className={styles.historyEmpty}>Nothing logged</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      <Button
        size="lg"
        block
        icon={<Plus size={17} strokeWidth={2.6} />}
        onClick={() => setAdding({})}
      >
        Add food
      </Button>

      <AddFoodSheet
        open={adding !== null}
        onClose={() => setAdding(null)}
        meal={adding?.meal}
        date={date}
        startIn={adding?.startIn ?? 'choose'}
      />
      <AddFoodSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        entry={editing ?? undefined}
        date={date}
      />
    </div>
  )
}
