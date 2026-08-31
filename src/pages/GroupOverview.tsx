import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Section } from '@/components/ui/Card'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/Progress'
import { GroupList } from '@/components/group/GroupList'
import { MemberSheet } from '@/components/group/MemberSheet'
import { useAuth } from '@/context/AuthContext'
import { achievementService, challengeService, progressService, userService } from '@/services'
import { todayKey, timeAgo } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './GroupOverview.module.css'

/**
 * The community dashboard.
 *
 * Who is here, how everyone is tracking, where the shared target stands, and
 * what has been earned. The header and tabs above belong to the Group shell,
 * so this file only ever renders what sits underneath them.
 *
 * Two things are deliberately absent. There is no chat — the conversation is
 * its own destination in the bottom bar. And there is no activity feed: the
 * Updates tab is the activity feed, and a second copy of its first four rows
 * here meant the same events were reported twice, three taps apart, with no
 * way to tell which one was authoritative.
 *
 * Tapping a person opens their progress over this screen rather than
 * navigating to it. You stay in Group.
 */
export function GroupOverview() {
  const { user } = useAuth()
  const today = todayKey()
  const [selected, setSelected] = useState<string | null>(null)

  const members = useLiveQuery(() => progressService.groupSnapshot(today), [today])
  const challenge = useLiveQuery(() => challengeService.progress(today), [today])
  // The three most recent unlocks across the whole group, so Awards has
  // something to say here without repeating the entire grid.
  const awards = useLiveQuery(async () => {
    // Members, not accounts. Somebody still waiting on approval is not in the
    // group, so nothing they have earned belongs on the group's board.
    const rows = await userService.listMembers()
    const recent = await Promise.all(
      rows.map(async (member) => {
        const [latest] = await achievementService.recent(member.id, 1)
        // `recent` only ever returns unlocked rows, but the view type keeps
        // unlockedAt optional because it is shared with the full grid.
        return latest?.unlockedAt
          ? { user: member, achievement: latest, unlockedAt: latest.unlockedAt }
          : null
      }),
    )
    return recent
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))
      .slice(0, 3)
  }, [])

  if (!user || !members) return <LoadingScreen />

  return (
    <>
      {/*
        --- Everyone ------------------------------------------------------
        One list of the group, not two. There used to be a second "Members"
        section further down printing the same three people with their handle
        and goal, opening the same sheet — so this row carries those as well
        and the duplicate is gone.
      */}
      <Section
        title="Everyone"
        action={
          <Link to="/group/progress" className={styles.sectionLink}>
            See all
          </Link>
        }
      >
        <GroupList
          members={members}
          currentUserId={user.id}
          onSelect={setSelected}
          showIdentity
        />
      </Section>

      {/* --- Challenge ----------------------------------------------------- */}
      {challenge ? (
        <Section
          title="This week's challenge"
          action={
            <Link to="/group/challenge" className={styles.sectionLink}>
              Details
            </Link>
          }
        >
          <Link to="/group/challenge" className={styles.challengeCard}>
            <span className={styles.challengeIcon} aria-hidden="true">
              {challenge.challenge.icon}
            </span>
            <span className={styles.challengeBody}>
              <span className={styles.challengeTitle}>{challenge.challenge.title}</span>
              <ProgressBar
                value={challenge.total}
                max={challenge.target}
                label={`${challenge.challenge.title}: ${challenge.pct}%`}
                tone={challenge.complete ? 'success' : 'accent'}
              />
              <span className={styles.challengeTally}>
                <span className="tnum">{num(challenge.total)}</span> of{' '}
                <span className="tnum">{num(challenge.target)}</span> {challenge.challenge.unit}
              </span>
            </span>
          </Link>
        </Section>
      ) : null}

      {/* --- Awards -------------------------------------------------------- */}
      {awards && awards.length > 0 ? (
        <Section
          title="Awards"
          action={
            <Link to="/group/awards" className={styles.sectionLink}>
              See all
            </Link>
          }
        >
          <ul className={styles.awards}>
            {awards.map((row) => (
              <li key={`${row.user.id}-${row.achievement.key}`} className={styles.award}>
                <span className={styles.awardIcon} aria-hidden="true">
                  {row.achievement.icon}
                </span>
                <span className={styles.awardText}>
                  <span className={styles.awardTitle}>{row.achievement.title}</span>
                  <span className={styles.awardMeta}>
                    {row.user.name} · {timeAgo(row.unlockedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <MemberSheet userId={selected} onClose={() => setSelected(null)} />
    </>
  )
}
