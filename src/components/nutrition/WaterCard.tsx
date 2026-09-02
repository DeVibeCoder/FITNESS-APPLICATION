import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Minus, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { ProgressBar } from '@/components/ui/Progress'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { nutritionService } from '@/services'
import { lastNDays, todayKey, weekdayLabel } from '@/utils/date'
import { clamp, litres, num } from '@/utils/format'
import styles from './WaterCard.module.css'

/**
 * Water for the selected day, plus a seven-day read. Uses the existing
 * WaterEntry rows — quick taps append, and "set exact" collapses the day to a
 * single figure rather than introducing a second hydration model.
 */
export function WaterCard({ date, goalL }: { date: string; goalL: number }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [editing, setEditing] = useState(false)
  const [custom, setCustom] = useState('')

  const ml = useLiveQuery(
    () => (user ? nutritionService.waterForDay(user.id, date) : undefined),
    [user?.id, date],
  )
  const week = useLiveQuery(
    () => (user ? nutritionService.history(user.id, lastNDays(7, date)) : undefined),
    [user?.id, date],
  )

  if (!user) return null

  const current = ml ?? 0
  const goalMl = goalL * 1000
  const days = lastNDays(7, date)
  const peak = Math.max(goalMl, ...Object.values(week ?? {}).map((d) => d.waterMl))

  const add = (amount: number) =>
    guard(() => nutritionService.addWater(user.id, date, amount))

  const saveExact = async () => {
    const litresValue = Number.parseFloat(custom)
    if (!Number.isFinite(litresValue) || litresValue < 0 || litresValue > 15) {
      show('Enter an amount between 0 and 15 litres.', 'error')
      return
    }
    const result = await guard(async () => {
      await nutritionService.setWaterTotal(user.id, date, Math.round(litresValue * 1000))
      return true
    })
    if (result) {
      show('Water updated.', 'success')
      setEditing(false)
    }
  }

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.head}>
          <p className={styles.value}>
            <span className="tnum">{litres(current)}</span>
            <span className={styles.of}>/ {goalL} L</span>
          </p>
          <button
            className={styles.edit}
            onClick={() => {
              setCustom((current / 1000).toFixed(1))
              setEditing(true)
            }}
          >
            Set exact
          </button>
        </div>

        <ProgressBar
          value={current}
          max={goalMl}
          tone={current >= goalMl ? 'success' : 'accent'}
          label="Water against goal"
        />

        <div className={styles.actions}>
          <button className={styles.quick} onClick={() => add(250)}>
            <Plus size={13} strokeWidth={2.6} />
            250 ml
          </button>
          <button className={styles.quick} onClick={() => add(500)}>
            <Plus size={13} strokeWidth={2.6} />
            500 ml
          </button>
          <button
            className={styles.undo}
            onClick={() => guard(() => nutritionService.removeLastWater(user.id, date))}
            disabled={current === 0}
            aria-label="Undo last"
          >
            <Minus size={14} strokeWidth={2.6} />
          </button>
        </div>

        <div className={styles.week}>
          {days.map((day) => {
            const amount = week?.[day]?.waterMl ?? 0
            const height = peak > 0 ? clamp((amount / peak) * 100, 3, 100) : 3
            return (
              <div key={day} className={styles.day}>
                <div className={styles.barTrack}>
                  <div
                    className={[styles.bar, amount >= goalMl ? styles.barHit : '']
                      .filter(Boolean)
                      .join(' ')}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <span className={styles.dayLabel}>{weekdayLabel(day).slice(0, 1)}</span>
                <span className={styles.dayValue}>{amount > 0 ? litres(amount) : '—'}</span>
              </div>
            )
          })}
        </div>
      </Card>

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Set water"
        subtitle={date === todayKey() ? "Today's total" : `Total for ${date}`}
      >
        <Field
          label="Amount"
          type="number"
          inputMode="decimal"
          step="0.1"
          suffix="L"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          hint={`Goal is ${num(goalL, 1)} L a day.`}
        />
        <Button size="lg" block onClick={saveExact}>
          Save
        </Button>
      </Sheet>
    </>
  )
}
