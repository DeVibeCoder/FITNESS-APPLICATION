import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { Section } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/Progress'
import { GroupList } from '@/components/group/GroupList'
import { UpdateFeed } from '@/components/group/UpdateFeed'
import { useAuth } from '@/context/AuthContext'
import { achievementService, challengeService, progressService, updateService, userService } from '@/services'
import { todayKey, timeAgo } from '@/utils/date'
import { goalLabel } from '@/utils/calories'
import { num } from '@/utils/format'
import styles from './GroupOverview.module.css'

/**
 * The community dashboard.
 *
 * Who is here, how everyone is tracking, what has happened, where the shared
 * target stands, and what has been earned — the state of the group on one
 * screen. The header and tabs above belong to the Group shell, so this file
 * only ever renders what sits underneath them.
 *
 * There is no chat here. Not a card, not a preview, not a tab: the conversation
 * is its own destination in the bottom bar.
 */
export function GroupOverview() {
  const { user } = useAuth()
  const today = todayKey()

  const members = useLiveQuery(() => progressService.groupSnapshot(today), [today])
  const users = useLiveQuery(() => userService.listMembers(), [])
  const challenge = useLiveQuery(() => challengeService.progress(today), [today])
  const updates = useLiveQuery(() => updateService.recent(4), [])
  // The three most recent unlocks across the whole group, so Awards has
  // something to say here without repeating the entire grid.
  const awards = useLiveQuery(async () => {
    const rows = await db.users.toArray()
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

  if (!user || !members || !users) return <LoadingScreen />

  const userMap = new Map(users.map((u) => [u.id, u]))

  return (
    <>
      {/* --- Group progress ---------------------------------------------- */}
      <Section
        title="Group progress"
        action={
          <Link to="/group/progress" className={styles.sectionLink}>
            See all
          </Link>
        }
      >
        <GroupList members={members} currentUserId={user.id} />
      </Section>

      {/* --- Latest activity ---------------------------------------------- */}
      <Section
        title="Latest activity"
        action={
          <Link to="/group/updates" className={styles.sectionLink}>
            See all
          </Link>
        }
      >
        <UpdateFeed updates={updates ?? []} users={userMap} />
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

      {/* --- Members ------------------------------------------------------- */}
      <Section title="Members">
        <ul className={styles.members}>
          {users.map((member) => (
            <li key={member.id}>
              <Link
                to={member.id === user.id ? '/profile' : `/u/${member.id}`}
                className={styles.member}
              >
                <Avatar user={member} size="md" />
                <span className={styles.memberText}>
                  <span className={styles.memberName}>
                    {member.name}
                    {member.id === user.id ? <span className={styles.you}>You</span> : null}
                  </span>
                  <span className={styles.memberGoal}>
                    @{member.handle} · {goalLabel(member.goal)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}
