import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Lock } from 'lucide-react'
import { Section } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/Progress'
import { CardArt } from '@/components/ui/CardArt'
import { AwardDetail, type AwardDetailData } from '@/components/achievements/AwardDetail'
import { useAuth } from '@/context/AuthContext'
import { achievementService, userService } from '@/services'
import { formatDay, toDateKey } from '@/utils/date'
import { ACHIEVEMENT_GROUPS } from '@/data/achievements'
import styles from './GroupAwards.module.css'

type Scope = 'mine' | 'group'

/**
 * What has been earned — yours, or everyone's.
 *
 * Two views of the same rows rather than two screens. "My awards" is the full
 * set including what is still locked, shown large, because the gaps in your
 * own collection are the useful part: they are the next thing to go for.
 * "Group awards" shows only what other people have actually unlocked — the
 * holes in somebody else's collection are not the group's business.
 *
 * Every mark opens. Nothing here is decoration: tapping one says what it is
 * and either why it was unlocked or exactly what would unlock it, both read
 * from the definitions the unlock rules use.
 */
export function GroupAwards() {
  const { user } = useAuth()
  const [scope, setScope] = useState<Scope>('mine')
  const [detail, setDetail] = useState<AwardDetailData | null>(null)

  const mine = useLiveQuery(
    () => (user ? achievementService.listForUser(user.id) : undefined),
    [user?.id],
  )

  const rows = useLiveQuery(async () => {
    const members = await userService.listMembers()
    return Promise.all(
      members.map(async (member) => ({
        user: member,
        all: await achievementService.listForUser(member.id),
      })),
    )
  }, [])

  if (!user || !mine || !rows) return <LoadingScreen />

  const total = mine.length
  const unlockedMine = mine.filter((a) => a.unlockedAt)
  const others = rows.filter((row) => row.user.id !== user.id)
  const earnedAcrossGroup = rows.reduce(
    (sum, row) => sum + row.all.filter((a) => a.unlockedAt).length,
    0,
  )

  return (
    <>
      <div className={styles.switch} role="tablist" aria-label="Whose awards">
        {(['mine', 'group'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={scope === value}
            className={[styles.tab, scope === value ? styles.tabOn : ''].filter(Boolean).join(' ')}
            onClick={() => setScope(value)}
          >
            {value === 'mine' ? 'My awards' : 'Group awards'}
          </button>
        ))}
      </div>

      {scope === 'mine' ? (
        <>
          <div className={`glass ${styles.summary}`}>
            <CardArt variant="award" />
            <p className="eyebrow">Your collection</p>
            <p className={styles.count}>
              <span className="tnum">{unlockedMine.length}</span>
              <span className={styles.of}>/ {total}</span>
            </p>
            <ProgressBar
              value={unlockedMine.length}
              max={Math.max(1, total)}
              label="Your awards unlocked"
              tone="accent"
            />
            <p className={styles.note}>
              Every one of these is worked out from what you have actually logged. Nothing is handed
              out, and nothing expires.
            </p>
          </div>

          {/*
            Grouped and large. This is the personal presentation: locked marks
            stay in place so the set reads as a map of what is possible rather
            than a list of what is missing.
          */}
          {ACHIEVEMENT_GROUPS.map((group) => {
            // Tier order, so "5 Workouts" always sits before "10 Workouts".
            const inGroup = mine
              .filter((a) => a.group === group.key)
              .sort((a, b) => a.tier - b.tier)
            if (inGroup.length === 0) return null
            return (
              <Section
                key={group.key}
                title={group.label}
                action={
                  <span className={styles.tally}>
                    <span className="tnum">{inGroup.filter((a) => a.unlockedAt).length}</span> of{' '}
                    <span className="tnum">{inGroup.length}</span>
                  </span>
                }
              >
                <ul className={styles.mineGrid}>
                  {inGroup.map((achievement) => (
                    <li key={achievement.key}>
                      <button
                        className={[styles.mark, achievement.unlockedAt ? '' : styles.markLocked]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setDetail({ achievement })}
                        aria-haspopup="dialog"
                      >
                        <span className={styles.markIcon} aria-hidden="true">
                          {achievement.unlockedAt ? (
                            achievement.icon
                          ) : (
                            <Lock size={18} strokeWidth={2} />
                          )}
                        </span>
                        <span className={styles.markTitle}>{achievement.title}</span>
                        <span className={styles.markMeta}>
                          {achievement.unlockedAt
                            ? formatDay(toDateKey(new Date(achievement.unlockedAt)))
                            : 'Locked'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )
          })}
        </>
      ) : (
        <>
          <div className={`glass ${styles.summary}`}>
            <CardArt variant="award" />
            <p className="eyebrow">Between the {rows.length} of you</p>
            <p className={styles.count}>
              <span className="tnum">{earnedAcrossGroup}</span>
              <span className={styles.of}>/ {total * rows.length}</span>
            </p>
            <ProgressBar
              value={earnedAcrossGroup}
              max={Math.max(1, total * rows.length)}
              label="Group awards unlocked"
              tone="accent"
            />
            <p className={styles.note}>
              Only what people have actually unlocked is shown here. What anyone has not earned yet
              is their own business.
            </p>
          </div>

          {others.length === 0 ? (
            <EmptyState
              compact
              title="Nobody else yet"
              body="When someone joins the group, what they earn shows up here."
            />
          ) : null}

          {others.map((row) => {
            const unlocked = row.all
              .filter((a) => a.unlockedAt)
              .sort((a, b) => (a.unlockedAt! < b.unlockedAt! ? 1 : -1))

            return (
              <Section
                key={row.user.id}
                title={row.user.name}
                action={
                  <span className={styles.tally}>
                    <span className="tnum">{unlocked.length}</span> of{' '}
                    <span className="tnum">{total}</span>
                  </span>
                }
              >
                <div className={styles.member}>
                  <div className={styles.memberHead}>
                    <Avatar user={row.user} size="md" />
                    <p className={styles.latest}>
                      {unlocked[0] ? (
                        <>
                          Latest: <strong>{unlocked[0].title}</strong> ·{' '}
                          {formatDay(toDateKey(new Date(unlocked[0].unlockedAt!)))}
                        </>
                      ) : (
                        'Nothing unlocked yet.'
                      )}
                    </p>
                  </div>

                  {unlocked.length > 0 ? (
                    <ul className={styles.groupGrid}>
                      {unlocked.map((achievement) => (
                        <li key={achievement.key}>
                          <button
                            className={styles.mark}
                            onClick={() => setDetail({ achievement, earnedBy: row.user })}
                            aria-haspopup="dialog"
                          >
                            <span className={styles.markIcon} aria-hidden="true">
                              {achievement.icon}
                            </span>
                            <span className={styles.markTitle}>{achievement.title}</span>
                            <span className={styles.markMeta}>
                              {formatDay(toDateKey(new Date(achievement.unlockedAt!)))}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Section>
            )
          })}
        </>
      )}

      <AwardDetail data={detail} onClose={() => setDetail(null)} />
    </>
  )
}
