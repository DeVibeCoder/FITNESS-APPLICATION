import { useLiveQuery } from 'dexie-react-hooks'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Card'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/Progress'
import { AchievementGrid } from '@/components/achievements/AchievementGrid'
import { useAuth } from '@/context/AuthContext'
import { achievementService } from '@/services'
import { ACHIEVEMENT_GROUPS } from '@/data/achievements'
import styles from './Achievements.module.css'

/**
 * Thirty-one marks across seven categories.
 *
 * Grouped rather than split into earned and locked: seeing "3 of 6" next to
 * Workouts tells you where you are in a way two undifferentiated piles cannot,
 * and the next one along is always the obvious next thing to go for.
 */
export function Achievements() {
  const { user } = useAuth()
  const achievements = useLiveQuery(
    () => (user ? achievementService.listForUser(user.id) : undefined),
    [user?.id],
  )

  if (!user || !achievements) return <LoadingScreen />

  const unlocked = achievements.filter((a) => a.unlockedAt)

  return (
    <div className={styles.page}>
      <PageHeader
        title="Achievements"
        subtitle={`${unlocked.length} of ${achievements.length} unlocked`}
        backTo="/me"
      />

      <div className={`glass ${styles.summary}`}>
        <p className={styles.count}>
          <span className="tnum">{unlocked.length}</span>
          <span className={styles.of}>/ {achievements.length}</span>
        </p>
        <ProgressBar
          value={unlocked.length}
          max={achievements.length}
          label="Achievements unlocked"
        />
        <p className={styles.note}>
          Every one of these is worked out from what you have actually logged. Nothing is handed
          out, and nothing expires.
        </p>
      </div>

      {ACHIEVEMENT_GROUPS.map(({ key, label }) => {
        // Tier order, so "5 Workouts" always sits before "10 Workouts".
        const inGroup = achievements
          .filter((a) => a.group === key)
          .sort((a, b) => a.tier - b.tier)
        if (inGroup.length === 0) return null
        const earned = inGroup.filter((a) => a.unlockedAt).length

        return (
          <Section
            key={key}
            title={label}
            action={
              <span className={styles.tally}>
                <span className="tnum">{earned}</span> of{' '}
                <span className="tnum">{inGroup.length}</span>
              </span>
            }
          >
            <AchievementGrid achievements={inGroup} />
          </Section>
        )
      })}
    </div>
  )
}
