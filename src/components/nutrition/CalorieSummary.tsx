import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/Progress'
import type { MacroTotals } from '@/services/nutritionService'
import type { EnergyPlan } from '@/utils/calories'
import { calorieStatus, macroProgress } from '@/utils/nutrition'
import { num } from '@/utils/format'
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
}: {
  totals: MacroTotals
  energy: EnergyPlan
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
      </ul>

      <p className={styles.note}>
        Targets are estimates from your profile, not exact requirements.
      </p>
    </Card>
  )
}
