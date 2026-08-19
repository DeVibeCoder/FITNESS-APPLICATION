import { Check, Droplets, Dumbbell, Flame, Footprints } from 'lucide-react'
import type { DailySnapshot } from '@/services/progressService'
import { litres, num } from '@/utils/format'
import styles from './TodayStrip.module.css'

/**
 * Four small blocks: did I train, have I moved, have I eaten, have I drunk.
 *
 * Deliberately compact. These are a glance, not the point of the screen — the
 * goal hero above and the workout card below carry the weight. Each one takes
 * its colour from what it means: coral for training, blue for movement, coral
 * for energy in, blue for water, green once a target is met.
 */
export function TodayStrip({ snapshot }: { snapshot: DailySnapshot }) {
  const workoutDone = snapshot.completedSessions.length > 0
  const stepsDone = snapshot.stepGoal > 0 && snapshot.steps >= snapshot.stepGoal
  const waterMl = snapshot.waterMl
  const waterGoalMl = snapshot.waterGoalMl
  const waterDone = waterGoalMl > 0 && waterMl >= waterGoalMl

  return (
    <ul className={styles.strip}>
      <Block
        tone={workoutDone ? 'done' : 'energy'}
        icon={workoutDone ? <Check size={14} strokeWidth={3} /> : <Dumbbell size={14} strokeWidth={2.3} />}
        label="Workout"
        value={workoutDone ? 'Done' : 'To do'}
        plain
      />
      <Block
        tone={stepsDone ? 'done' : 'move'}
        icon={<Footprints size={14} strokeWidth={2.3} />}
        label="Steps"
        value={num(snapshot.steps)}
      />
      <Block
        tone="nutrition"
        icon={<Flame size={14} strokeWidth={2.3} />}
        label="Calories"
        value={num(snapshot.nutrition.kcal)}
      />
      <Block
        tone={waterDone ? 'done' : 'move'}
        icon={<Droplets size={14} strokeWidth={2.3} />}
        label="Water"
        value={litres(waterMl)}
        suffix="L"
      />
    </ul>
  )
}

function Block({
  tone,
  icon,
  label,
  value,
  suffix,
  plain,
}: {
  tone: 'energy' | 'move' | 'done' | 'nutrition'
  icon: React.ReactNode
  label: string
  value: string
  suffix?: string
  /** A word rather than a figure, so it should not use the numeric face. */
  plain?: boolean
}) {
  return (
    <li className={`${styles.block} ${styles[tone]}`}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
      <span className={plain ? styles.word : `stat ${styles.value}`}>
        {value}
        {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </span>
    </li>
  )
}
