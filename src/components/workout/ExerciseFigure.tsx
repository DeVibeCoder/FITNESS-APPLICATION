import type { Exercise } from '@/models'
import styles from './ExerciseFigure.module.css'

/**
 * Stands in for exercise artwork, which the app does not ship yet.
 *
 * Rather than a grey box, it draws a calm generated mark derived from the
 * exercise name, so every exercise looks distinct and deliberate. The moment
 * `exercise.imageUrl` is populated this renders the real image instead — no
 * other code changes.
 */
export function ExerciseFigure({ exercise }: { exercise: Exercise }) {
  if (exercise.imageUrl) {
    return (
      <div className={styles.figure}>
        <img src={exercise.imageUrl} alt="" className={styles.image} />
      </div>
    )
  }

  // Stable per exercise: same name always yields the same arrangement.
  let hash = 0
  for (let i = 0; i < exercise.name.length; i++) {
    hash = (hash * 31 + exercise.name.charCodeAt(i)) >>> 0
  }
  const rotation = hash % 360
  const offset = 18 + (hash % 22)

  return (
    <div className={styles.figure}>
      <svg viewBox="0 0 200 120" className={styles.mark} aria-hidden="true">
        <g transform={`rotate(${rotation} 100 60)`}>
          <circle cx="100" cy="60" r="34" className={styles.ring} />
          <circle cx={100 + offset} cy="60" r="18" className={styles.dot} />
        </g>
      </svg>
      <span className={styles.groups}>{exercise.muscleGroups.join(' · ')}</span>
    </div>
  )
}
