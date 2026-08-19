import { useLiveQuery } from 'dexie-react-hooks'
import { Section } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/Progress'
import { AchievementGrid } from '@/components/achievements/AchievementGrid'
import { useAuth } from '@/context/AuthContext'
import { achievementService, userService } from '@/services'
import { timeAgo } from '@/utils/date'
import styles from './GroupAwards.module.css'

/**
 * What the group has earned.
 *
 * Distinct from /achievements, which is your own set including everything you
 * have not unlocked yet. This is the shared version: how far along each person
 * is and what they have taken most recently. Locked marks are omitted — the
 * gaps in someone else's collection are not the group's business.
 */
export function GroupAwards() {
  const { user } = useAuth()
  const users = useLiveQuery(() => userService.listMembers(), [])

  const rows = useLiveQuery(async () => {
    const members = await userService.listMembers()
    return Promise.all(
      members.map(async (member) => ({
        user: member,
        all: await achievementService.listForUser(member.id),
        recent: await achievementService.recent(member.id, 6),
      })),
    )
  }, [])

  if (!user || !users || !rows) return <LoadingScreen />

  const total = rows[0]?.all.length ?? 0
  const earned = rows.reduce((sum, row) => sum + row.all.filter((a) => a.unlockedAt).length, 0)

  return (
    <>
      <div className={`glass ${styles.summary}`}>
        <p className="eyebrow">Between the {rows.length} of you</p>
        <p className={styles.count}>
          <span className="tnum">{earned}</span>
          <span className={styles.of}>/ {total * rows.length}</span>
        </p>
        <ProgressBar
          value={earned}
          max={Math.max(1, total * rows.length)}
          label="Group awards unlocked"
          tone="accent"
        />
        <p className={styles.note}>
          Every one of these is worked out from what people have actually logged. Nothing is handed
          out, and nothing expires.
        </p>
      </div>

      {rows.map((row) => {
        const mine = row.all.filter((a) => a.unlockedAt)
        const latest = row.recent[0]

        return (
          <Section
            key={row.user.id}
            title={row.user.id === user.id ? `${row.user.name} (you)` : row.user.name}
            action={
              <span className={styles.tally}>
                <span className="tnum">{mine.length}</span> of <span className="tnum">{total}</span>
              </span>
            }
          >
            <div className={styles.member}>
              <div className={styles.memberHead}>
                <Avatar user={row.user} size="md" />
                <p className={styles.latest}>
                  {latest ? (
                    <>
                      Latest: <strong>{latest.title}</strong> · {timeAgo(latest.unlockedAt!)}
                    </>
                  ) : (
                    'Nothing unlocked yet.'
                  )}
                </p>
              </div>
              {row.recent.length > 0 ? (
                <AchievementGrid achievements={row.recent} showLocked={false} />
              ) : null}
            </div>
          </Section>
        )
      })}
    </>
  )
}
