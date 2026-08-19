import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import type { User } from '@/models'
import { calcBmi, bmiScalePosition, BMI_BANDS } from '@/utils/bmi'
import { num } from '@/utils/format'
import styles from './BmiCard.module.css'

/**
 * BMI from the profile's height and the latest weigh-in, plus a what-if panel.
 *
 * The calculator never writes anything: it is for "what would that be at 72 kg",
 * not for editing the profile. All arithmetic comes from `calcBmi` — the formula
 * lives in exactly one place.
 */
export function BmiCard({ user, currentWeightKg }: { user: User; currentWeightKg: number }) {
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(String(user.heightCm))
  const [weight, setWeight] = useState(currentWeightKg.toFixed(1))

  const actual = calcBmi(currentWeightKg, user.heightCm)

  const tryHeight = Number.parseFloat(height)
  const tryWeight = Number.parseFloat(weight)
  const valid =
    Number.isFinite(tryHeight) && tryHeight >= 100 && tryHeight <= 250 &&
    Number.isFinite(tryWeight) && tryWeight >= 20 && tryWeight <= 400
  const preview = valid ? calcBmi(tryWeight, tryHeight) : null

  const shown = open && preview ? preview : actual

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <div>
          <p className={`${styles.value} tnum`}>{num(shown.value, 1)}</p>
          <p className={styles.label}>
            {shown.label}
            {open && preview && preview.value !== actual.value ? (
              <span className={styles.preview}> · preview</span>
            ) : null}
          </p>
        </div>
        <p className={styles.range}>
          Healthy for {open && preview ? `${num(tryHeight, 0)} cm` : 'your height'}:
          <br />
          <span className="tnum">
            {num(shown.healthyRangeKg[0], 1)}–{num(shown.healthyRangeKg[1], 1)} kg
          </span>
        </p>
      </div>

      <div className={styles.scale}>
        <div className={styles.bands}>
          {BMI_BANDS.map((band) => (
            <span
              key={band.category}
              className={`${styles.band} ${styles[band.category]}`}
              style={{ flexGrow: band.to - band.from }}
            >
              {band.label}
            </span>
          ))}
        </div>
        <span
          className={styles.marker}
          style={{ left: `${bmiScalePosition(shown.value) * 100}%` }}
          aria-hidden="true"
        />
      </div>

      <p className={styles.explain}>
        BMI is one general screening measure and does not capture body composition,
        muscle mass or how you actually feel. Treat it as a rough signal, not a verdict.
      </p>

      <button className={styles.toggle} onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide calculator' : 'Try different numbers'}
      </button>

      {open ? (
        <div className={styles.calculator}>
          <div className={styles.inputs}>
            <Field
              label="Height"
              type="number"
              inputMode="decimal"
              suffix="cm"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
            <Field
              label="Weight"
              type="number"
              inputMode="decimal"
              step="0.1"
              suffix="kg"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
          </div>
          <p className={styles.calcNote}>
            {valid
              ? 'Nothing is saved here. Edit your profile to change the numbers the app uses.'
              : 'Enter a height between 100–250 cm and a weight between 20–400 kg.'}
          </p>
        </div>
      ) : null}
    </Card>
  )
}
