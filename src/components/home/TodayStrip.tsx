import { Check, Droplets, Dumbbell, Flame, Footprints } from 'lucide-react'
import type { DailySnapshot } from '@/services/progressService'
import { litres, num } from '@/utils/format'
import styles from './TodayStrip.module.css'

/**
 * Four numbers: did I train, have I moved, have I eaten, have I drunk.
 *
 * A grid of small cells rather than four cards. This is the glance at the top
 * of Activity, and it used to take a third of the first screen for four values
 * that fit in two lines each — the icon sat in its own 26px block above a
 * label above a figure. The icon is inline with the label now and the cells
 * are half the height, which is the difference between a summary and a
 * section.
 *
 * Colour follows meaning, and there are only three: the brand for effort and
 * energy, blue for movement and water, green once a target is met.
 */
export function TodayStrip({ snapshot }: { snapshot: DailySnapshot }) {
  const workoutDone = snapshot.completedSessions.length > 0
  const stepsDone = snapshot.stepGoal > 0 && snapshot.steps >= snapshot.stepGoal
  const waterMl = snapshot.waterMl
  const waterGoalMl = snapshot.waterGoalMl
  const waterDone = waterGoalMl > 0 && waterMl >= waterGoalMl

  return (
    <ul className={styles.strip}>
      <Cell
        tone={workoutDone ? 'done' : 'energy'}
        icon={workoutDone ? <Check size={12} strokeWidth={3} /> : <Dumbbell size={12} strokeWidth={2.4} />}
        label="Workout"
        value={workoutDone ? 'Completed' : 'To do'}
        plain
      />
      <Cell
        tone={stepsDone ? 'done' : 'move'}
        icon={<Footprints size={12} strokeWidth={2.4} />}
        label="Steps"
        value={num(snapshot.steps)}
      />
      <Cell
        tone="energy"
        icon={<Flame size={12} strokeWidth={2.4} />}
        label="Calories"
        value={num(snapshot.nutrition.kcal)}
      />
      <Cell
        tone={waterDone ? 'done' : 'move'}
        icon={<Droplets size={12} strokeWidth={2.4} />}
        label="Water"
        value={litres(waterMl)}
        suffix="L"
      />
    </ul>
  )
}

function Cell({
  tone,
  icon,
  label,
  value,
  suffix,
  plain,
}: {
  tone: 'energy' | 'move' | 'done'
  icon: React.ReactNode
  label: string
  value: string
  suffix?: string
  /** A word rather than a figure, so it should not use the numeric face. */
  plain?: boolean
}) {
  return (
    <li className={`${styles.cell} ${styles[tone]}`}>
      <span className={styles.label}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <span className={plain ? styles.word : `stat ${styles.value}`}>
        {value}
        {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </span>
    </li>
  )
}
