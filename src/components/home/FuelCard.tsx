import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, GlassWater, Plus, UtensilsCrossed } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { CardPhoto } from '@/components/ui/CardPhoto'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { useToast } from '@/context/ToastContext'
import { nutritionService } from '@/services'
import type { DailySnapshot } from '@/services/progressService'
import { todayKey } from '@/utils/date'
import { clamp, litres, num } from '@/utils/format'
import styles from './FuelCard.module.css'

/**
 * Calories and water share a card: they are the two things logged during the
 * day rather than at the end of it, and separating them made the page long
 * without making either clearer.
 */
export function FuelCard({ snapshot }: { snapshot: DailySnapshot }) {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const { guard } = useToast()
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const eaten = snapshot.nutrition.kcal
  const target = snapshot.energy.target
  const over = eaten > target
  const difference = Math.abs(target - eaten)
  const kcalPct = target > 0 ? clamp((eaten / target) * 100, 0, 100) : 0

  const protein = Math.round(snapshot.nutrition.proteinG)
  const proteinTarget = Math.round(snapshot.energy.macros.proteinG)
  const proteinPct = proteinTarget > 0 ? clamp((protein / proteinTarget) * 100, 0, 100) : 0

  const waterPct =
    snapshot.waterGoalMl > 0 ? clamp((snapshot.waterMl / snapshot.waterGoalMl) * 100, 0, 100) : 0
  const waterHit = snapshot.waterMl >= snapshot.waterGoalMl

  const addWater = async (ml: number) => {
    setBusy(true)
    await guard(() => nutritionService.addWater(user.id, todayKey(), ml))
    setBusy(false)
  }

  return (
    <Card flush className={styles.card}>
      {/* Two halves, two photographs — the subjects are different questions. */}
      <section className={`onPhoto ${styles.half}`}>
        <CardPhoto image="calories" />
        <div className={styles.body}>
          <header className={styles.head}>
            <span className={styles.label}>
              <UtensilsCrossed size={13} strokeWidth={2} />
              Calories
            </span>
            <button className={styles.action} onClick={() => open('meal')}>
              <Plus size={13} strokeWidth={2.6} />
              Add food
            </button>
          </header>

          <p className={styles.readout}>
            <span className={`${styles.value} tnum`}>{num(eaten)}</span>
            <span className={styles.of}>
              / <span className="tnum">{num(target)}</span> kcal
            </span>
          </p>

          <div className={styles.track}>
            <div
              className={[styles.fill, over ? styles.fillWarn : ''].filter(Boolean).join(' ')}
              style={{ width: `${kcalPct}%` }}
            />
          </div>

          <p className={styles.note}>
            {eaten === 0 ? (
              // Nothing eaten yet is a fact, not a budget. "2,100 kcal left"
              // against an empty log reads like progress nobody has made.
              <span className={styles.strong}>No nutrition logged</span>
            ) : (
              <span className={over ? styles.warn : styles.strong}>
                <span className="tnum">{num(difference)}</span> kcal {over ? 'over' : 'left'}
              </span>
            )}
            <span className={styles.estimate}> · estimated daily target</span>
          </p>

          {/*
            Protein, on the same card rather than a section of its own. It is
            the one macro somebody actually steers during the day, and calories
            without it is half the answer — but it is context under the
            headline, so it gets a line and a hairline bar, not a second
            readout competing with the number above it.
          */}
          <div className={styles.macro}>
            <span className={styles.macroLabel}>Protein</span>
            <span className={styles.macroValue}>
              <span className="tnum">{num(protein)}</span> /{' '}
              <span className="tnum">{num(proteinTarget)}</span> g
            </span>
          </div>
          <div className={`${styles.track} ${styles.trackThin}`}>
            <div
              className={`${styles.fill} ${styles.fillProtein}`}
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        </div>
      </section>

      <section className={`onPhoto ${styles.half}`}>
        <CardPhoto image="water" />
        <div className={styles.body}>
          <header className={styles.head}>
            <span className={styles.label}>
              <GlassWater size={13} strokeWidth={2} />
              Water
            </span>
            {/*
              Setting an exact amount, and the week's history, live on the
              nutrition page — this card is the summary, and having two places
              that both own the day's water is how the two come to disagree.
            */}
            <Link className={styles.action} to="/activity/nutrition">
              Set exact
              <ChevronRight size={13} strokeWidth={2.4} />
            </Link>
          </header>

          <p className={styles.readout}>
            <span className={`${styles.value} tnum`}>{litres(snapshot.waterMl)}</span>
            <span className={styles.of}>
              / <span className="tnum">{num(snapshot.waterGoalMl / 1000, 1)}</span> L
            </span>
          </p>

          <div className={styles.track}>
            <div
              className={[styles.fill, styles.fillWater, waterHit ? styles.fillDone : ''].filter(Boolean).join(' ')}
              style={{ width: `${waterPct}%` }}
            />
          </div>

          <div className={styles.waterActions}>
            <button className={styles.quick} onClick={() => addWater(250)} disabled={busy}>
              <Plus size={13} strokeWidth={2.6} />
              250 ml
            </button>
            <button className={styles.quick} onClick={() => addWater(500)} disabled={busy}>
              <Plus size={13} strokeWidth={2.6} />
              500 ml
            </button>
          </div>
        </div>
      </section>
    </Card>
  )
}
