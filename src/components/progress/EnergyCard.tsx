import { Card } from '@/components/ui/Card'
import type { EnergyPlan } from '@/utils/calories'
import { activityLabel, goalLabel } from '@/utils/calories'
import type { User } from '@/models'
import { num, signed } from '@/utils/format'
import styles from './EnergyCard.module.css'

/**
 * BMR → TDEE → goal adjustment → daily target, with the macro split.
 *
 * Every number here comes from `calcEnergyPlan`; this component only formats.
 * The wording is deliberately hedged throughout — these are estimates from a
 * formula, not measurements, and the app should never pretend otherwise.
 */
export function EnergyCard({
  user,
  energy,
  /** The chain explainer is worth showing once, on the dedicated tab. */
  detailed = false,
}: {
  user: User
  energy: EnergyPlan
  detailed?: boolean
}) {
  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <div>
          <p className={styles.label}>Estimated daily target</p>
          <p className={styles.target}>
            <span className="tnum">{num(energy.target)}</span>
            <span className={styles.unit}>kcal/day</span>
          </p>
          <p className={styles.basis}>
            {goalLabel(user.goal)} · {activityLabel(user.activityLevel)}
          </p>
        </div>
        <ul className={styles.macros}>
          <li>
            <span>Protein</span>
            <span className="tnum">{energy.macros.proteinG} g</span>
          </li>
          <li>
            <span>Carbs</span>
            <span className="tnum">{energy.macros.carbsG} g</span>
          </li>
          <li>
            <span>Fat</span>
            <span className="tnum">{energy.macros.fatG} g</span>
          </li>
        </ul>
      </div>

      <dl className={styles.chain}>
        <div>
          <dt>Estimated BMR</dt>
          <dd className="tnum">{num(energy.bmr)}</dd>
          {detailed ? <p className={styles.hint}>Energy your body uses at rest.</p> : null}
        </div>
        <div>
          <dt>Estimated TDEE</dt>
          <dd className="tnum">{num(energy.tdee)}</dd>
          {detailed ? (
            <p className={styles.hint}>Daily needs including your activity level.</p>
          ) : null}
        </div>
        <div>
          <dt>Goal adjustment</dt>
          <dd className={`${styles.adjust} tnum`}>{signed(energy.adjustment, 0)}</dd>
          {detailed ? (
            <p className={styles.hint}>
              {energy.adjustment < 0
                ? 'A moderate deficit you can hold.'
                : energy.adjustment > 0
                  ? 'A modest surplus to build on.'
                  : 'Holding at maintenance.'}
            </p>
          ) : null}
        </div>
      </dl>

      <p className={styles.note}>
        These are estimates based on your current profile — height, weight, age, sex and
        activity level. Macros are targets to aim near, not exact amounts. Adjust them
        against what actually happens on the scale over a few weeks.
      </p>
    </Card>
  )
}
