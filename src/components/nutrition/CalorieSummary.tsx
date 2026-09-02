import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/Progress'
import type { MacroTotals } from '@/services/nutritionService'
import type { EnergyPlan } from '@/utils/calories'
import { calorieStatus, macroProgress } from '@/utils/nutrition'
import { litres, num } from '@/utils/format'
import styles from './CalorieSummary.module.css'

/**
 * One card, not four. The calorie number is the headline; the macros sit under
 * it as thin bars because they are context, not four separate scores.
 */
/**
 * A colour per macro, drawn from the same semantic set as the rest of the app
 * rather than three arbitrary hues: protein builds (green), carbs fuel
 * movement (blue), fat is stored energy (coral).
 */
const MACRO_TONE: Record<string, 'success' | 'move' | 'energy'> = {
  protein: 'success',
  carbs: 'move',
  fat: 'energy',
}

export function CalorieSummary({
  totals,
  energy,
  waterMl,
  waterGoalMl,
}: {
  totals: MacroTotals
  energy: EnergyPlan
  /** Today's water, read-only here — the water card below owns changing it. */
  waterMl: number
  waterGoalMl: number
}) {
  const status = calorieStatus(totals.kcal, energy.target)
  const macros = macroProgress(totals, energy.macros)

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <div>
          <p className={styles.value}>
            <span className="tnum">{num(totals.kcal)}</span>
            <span className={styles.of}>
              / <span className="tnum">{num(energy.target)}</span> kcal
            </span>
          </p>
          <p className={`${styles.status} ${styles[status.tone]}`}>{status.label}</p>
        </div>
        <div className={styles.remaining}>
          <span className={styles.remainingValue}>
            <span className="tnum">{num(Math.abs(status.remaining))}</span>
          </span>
          <span className={styles.remainingLabel}>
            {status.remaining >= 0 ? 'kcal left' : 'kcal over'}
          </span>
        </div>
      </div>

      <ProgressBar
        value={totals.kcal}
        max={energy.target}
        tone={status.tone === 'over' ? 'warn' : 'accent'}
        label="Calories against target"
      />

      <ul className={styles.macros}>
        {macros.map((macro) => (
          <li key={macro.key}>
            <div className={styles.macroHead}>
              <span>{macro.label}</span>
              <span className={styles.macroValue}>
                <span className="tnum">{macro.consumed}</span> /{' '}
                <span className="tnum">{macro.target}</span> g
              </span>
            </div>
            <ProgressBar
              value={macro.consumed}
              max={macro.target}
              size="sm"
              tone={MACRO_TONE[macro.key] ?? 'accent'}
              label={macro.label}
            />
          </li>
        ))}
        {/*
          Water finishes the day's totals rather than being a number you have
          to scroll for. It is shown, not edited: the water card below is the
          one place the amount is changed.
        */}
        <li>
          <div className={styles.macroHead}>
            <span>Water</span>
            <span className={styles.macroValue}>
              <span className="tnum">{litres(waterMl)}</span> /{' '}
              <span className="tnum">{num(waterGoalMl / 1000, 1)}</span> L
            </span>
          </div>
          <ProgressBar
            value={waterMl}
            max={waterGoalMl}
            size="sm"
            tone={waterMl >= waterGoalMl ? 'success' : 'move'}
            label="Water"
          />
        </li>
      </ul>

      <p className={styles.note}>
        Targets are estimates from your profile, not exact requirements.
      </p>
    </Card>
  )
}
