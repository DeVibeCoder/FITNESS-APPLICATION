import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Section } from '@/components/ui/Card'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { MemberCard } from '@/components/group/MemberCard'
import { MemberSheet } from '@/components/group/MemberSheet'
import { GroupWeek } from '@/components/group/GroupWeek'
import { useAuth } from '@/context/AuthContext'
import { achievementService, progressService, userService } from '@/services'
import { reviewService } from '@/services/reviewService'
import { formatRange, startOfWeek, endOfWeek, todayKey } from '@/utils/date'
import styles from './OurProgress.module.css'

/**
 * The shared accountability screen: how everyone else is doing.
 *
 * This is the counterpart of the Progress tab, not a second copy of it. That
 * one is your own weight, your own goal, your own history. This one is the
 * other people — their goal direction, where they started and are now, this
 * week's change, workouts, steps, consistency and how far along each of them
 * is. Public group data only: nothing from anyone's body metrics, calorie
 * targets or food diary appears here.
 *
 * Tapping a member opens their progress over this screen. It used to navigate
 * to a page outside Group, which meant comparing two people cost four
 * navigations and lost your place both times.
 *
 * There is no updates feed here any more. Updates is a tab of its own, three
 * inches to the left.
 */
export function OurProgress() {
  const { user } = useAuth()
  const today = todayKey()
  const [selected, setSelected] = useState<string | null>(null)

  const members = useLiveQuery(() => progressService.groupSnapshot(today), [today])
  const week = useLiveQuery(() => reviewService.groupWeek(today), [today])

  // Both of these key off the same list the board is built from: a pending or
  // rejected account is not part of the group and must not appear beside one.
  const weeklyChanges = useLiveQuery(async () => {
    const rows = await userService.listMembers()
    const entries = await Promise.all(
      rows.map(async (member) => {
        const summary = await progressService.weeklySummary(member.id, today)
        return [member.id, summary.weightChangeKg] as const
      }),
    )
    return Object.fromEntries(entries) as Record<string, number | undefined>
  }, [today])

  const achievements = useLiveQuery(async () => {
    const rows = await userService.listMembers()
    const entries = await Promise.all(
      rows.map(async (member) => [member.id, (await achievementService.recent(member.id, 1))[0]] as const),
    )
    return Object.fromEntries(entries)
  }, [])

  if (!user || !members) return <LoadingScreen />

  return (
    // data-wide: this tab has a two-column desktop layout, so it asks the Group
    // shell to drop its reading-width cap. See GroupLayout.module.css.
    <div className={styles.page} data-wide>
      {/*
        No page header and no back arrow: the Group shell above is still on
        screen, and this is one of its tabs. The section says what this is and
        over what window.
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
                    onOpen={() => setSelected(member.user.id)}
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
          {/*
            The one link off this page, and it points at the personal side of
            the same question rather than at another copy of this one.
          */}
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

      <MemberSheet userId={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
