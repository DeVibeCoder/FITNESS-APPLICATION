import { Lock } from 'lucide-react'
import type { AchievementView } from '@/services/achievementService'
import { formatDay, toDateKey } from '@/utils/date'
import styles from './AchievementGrid.module.css'

/**
 * Small marks, not trophies. Locked ones stay visible but quiet so the set
 * reads as a map of what is possible rather than a list of what is missing.
 */
export function AchievementGrid({
  achievements,
  showLocked = true,
}: {
  achievements: AchievementView[]
  showLocked?: boolean
}) {
  const shown = showLocked ? achievements : achievements.filter((a) => a.unlockedAt)

  return (
    <ul className={styles.grid}>
      {shown.map((achievement) => (
        <li
          key={achievement.key}
          className={[styles.item, achievement.unlockedAt ? '' : styles.locked]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.icon} aria-hidden="true">
            {achievement.unlockedAt ? achievement.icon : <Lock size={14} strokeWidth={2} />}
          </span>
          <span className={styles.title}>{achievement.title}</span>
          <span className={styles.meta}>
            {achievement.unlockedAt
              ? `Unlocked ${formatDay(toDateKey(new Date(achievement.unlockedAt)))}`
              : achievement.description}
          </span>
        </li>
      ))}
    </ul>
  )
}
