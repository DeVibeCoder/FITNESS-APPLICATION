import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { Section } from '@/components/ui/Card'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { MemberCard } from '@/components/group/MemberCard'
import { GroupWeek } from '@/components/group/GroupWeek'
import { UpdateFeed } from '@/components/group/UpdateFeed'
import { useAuth } from '@/context/AuthContext'
import { achievementService, progressService, updateService } from '@/services'
import { reviewService } from '@/services/reviewService'
import { formatRange, startOfWeek, endOfWeek, todayKey } from '@/utils/date'
import styles from './OurProgress.module.css'

/**
 * The shared accountability screen. Public group data only — goal, progress,
 * training, steps, streak, consistency, achievements and the feed. Nothing from
 * anyone's body metrics, targets or food diary appears here.
 */
export function OurProgress() {
  const { user } = useAuth()
  const today = todayKey()

  const members = useLiveQuery(() => progressService.groupSnapshot(today), [today])
  const week = useLiveQuery(() => reviewService.groupWeek(today), [today])
  const updates = useLiveQuery(() => updateService.recent(10), [])
  const users = useLiveQuery(() => db.users.toArray(), [])

  const weeklyChanges = useLiveQuery(async () => {
    const rows = await db.users.toArray()
    const entries = await Promise.all(
      rows.map(async (member) => {
        const summary = await progressService.weeklySummary(member.id, today)
        return [member.id, summary.weightChangeKg] as const
      }),
    )
    return Object.fromEntries(entries) as Record<string, number | undefined>
  }, [today])

  const achievements = useLiveQuery(async () => {
    const rows = await db.users.toArray()
    const entries = await Promise.all(
      rows.map(async (member) => [member.id, (await achievementService.recent(member.id, 1))[0]] as const),
    )
    return Object.fromEntries(entries)
  }, [])

  if (!user || !members) return <LoadingScreen />

  const userMap = new Map((users ?? []).map((u) => [u.id, u]))

  return (
    // data-wide: this tab has a two-column desktop layout, so it asks the Group
    // shell to drop its reading-width cap. See GroupLayout.module.css.
    <div className={styles.page} data-wide>
      {/*
        No page header and no back arrow: the Group shell above is still on
        screen, and this is one of its tabs. §42 asks for a clear heading, so
        the section says what this is and over what window.
      */}
      <div className={styles.intro}>
        <h2 className={styles.heading}>Group progress</h2>
        <p className={styles.range}>{formatRange(startOfWeek(today), endOfWeek(today))}</p>
      </div>

      <div className={styles.columns}>
        <div className={styles.main}>
          <Section title="Everyone">
            <ul className={styles.members}>
              {members.map((member) => (
                <li key={member.user.id}>
                  <MemberCard
                    member={member}
                    isYou={member.user.id === user.id}
                    weeklyChangeKg={weeklyChanges?.[member.user.id]}
                    recentAchievement={achievements?.[member.user.id]}
                  />
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Our week">
            {week ? <GroupWeek categories={week} currentUserId={user.id} /> : null}
          </Section>
        </div>

        <div className={styles.rail}>
          <Section
            title="Recent updates"
            action={
              <Link to="/group/updates" className={styles.link}>
                See all
              </Link>
            }
          >
            <UpdateFeed updates={updates ?? []} users={userMap} />
          </Section>

          <Section title="Your week">
            <Link to="/review" className={styles.reviewLink}>
              <span className={styles.reviewText}>
                <span className={styles.reviewTitle}>Weekly review</span>
                <span className={styles.reviewHint}>How your own week went</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          </Section>
        </div>
      </div>
    </div>
  )
}
