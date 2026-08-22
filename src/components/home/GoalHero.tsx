import { CardPhoto } from '@/components/ui/CardPhoto'
import type { User } from '@/models'
import type { WeightProgress } from '@/utils/progress'
import { goalLabel } from '@/utils/calories'
import { goalProfile } from '@/utils/goals'
import { num } from '@/utils/format'
import styles from './GoalHero.module.css'

/**
 * The one thing Progress is about: how far along you are.
 *
 * Drawn as a track rather than a ring. A weight goal is a journey between two
 * numbers, and a straight line from where you started to where you are going
 * says that far better than a donut — the marker's position *is* the story,
 * and both ends stay labelled the whole time.
 *
 * It is the screen's one photographic card. Everything below it is a table or
 * a chart that needs an opaque surface to be read on, so the picture belongs
 * here or nowhere — and here it sits behind the single number the whole page
 * exists to state.
 *
 * Purely presentational: every figure comes from `weightProgress`, which this
 * component does not touch.
 */
export function GoalHero({ user, progress }: { user: User; progress: WeightProgress }) {
  const profile = goalProfile(user.goal)
  const pct = Math.round(progress.pct)

  return (
    <section className={`onPhoto ${styles.hero}`} aria-labelledby="goal-hero-title">
      <CardPhoto image="journey" />
      <header className={styles.head}>
        <p className="eyebrow">Your goal</p>
        <span className={styles.badge}>{goalLabel(user.goal)}</span>
      </header>

      <div className={styles.readout}>
        <p className={styles.now}>
          <span className={`stat ${styles.value}`}>{num(progress.currentKg, 1)}</span>
          <span className="unit">kg</span>
        </p>
        <p className={styles.pct} id="goal-hero-title">
          <span className={`stat ${styles.pctValue}`}>{pct}</span>
          <span className={styles.pctSign}>%</span>
          <span className={styles.pctLabel}>
            {progress.reached ? 'goal reached' : 'toward goal'}
          </span>
        </p>
      </div>

      {profile.usesTargetWeight ? (
        <div className={styles.track}>
          <div
            className={styles.rail}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% toward your goal weight`}
          >
            <div className={styles.fill} style={{ width: `${pct}%` }} />
            {/*
              The marker rides the end of the fill. Its own transform keeps it
              centred on the boundary at 0% and 100% alike, so it never hangs
              off either end of the rail.
            */}
            <span className={styles.marker} style={{ left: `${pct}%` }} aria-hidden="true" />
          </div>

          <div className={styles.ends}>
            <span className={styles.end}>
              <span className={styles.endLabel}>Start</span>
              <span className={`tnum ${styles.endValue}`}>{num(progress.startKg, 1)}</span>
            </span>
            <span className={`${styles.end} ${styles.endRight}`}>
              <span className={styles.endLabel}>Goal</span>
              <span className={`tnum ${styles.endValue}`}>{num(progress.targetKg, 1)}</span>
            </span>
          </div>
        </div>
      ) : (
        <p className={styles.noTarget}>{profile.tagline}</p>
      )}

      <p className={styles.remaining}>
        {progress.reached
          ? 'You said you would, and you did.'
          : profile.usesTargetWeight
            ? `${num(progress.remainingKg, 1)} kg to go`
            : `${num(Math.abs(progress.changeKg), 1)} kg since you started`}
      </p>
    </section>
  )
}
