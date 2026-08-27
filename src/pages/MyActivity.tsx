import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Card'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { PostCard } from '@/components/social/PostCard'
import { SessionCard } from '@/components/workout/SessionCard'
import { AchievementGrid } from '@/components/achievements/AchievementGrid'
import { useAuth } from '@/context/AuthContext'
import { achievementService, postService, storyService, weightService, workoutService } from '@/services'
import { formatDay } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { withDeltas } from '@/utils/progress'
import styles from './MyActivity.module.css'

type Tab = 'posts' | 'fitness'

/**
 * Everything this person has put into the app.
 *
 * Split out of Me, which had grown into a directory of the whole application.
 * Me is now identity and settings; this is the record — what you posted and
 * what you logged — and it can grow without pushing the settings off screen.
 *
 * Called "My records" rather than "My activity": the Activity tab is now
 * explicitly one person's day, and two screens with the same name in the same
 * app is a navigation bug however good each one is.
 */
export function MyActivity() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('posts')

  const posts = useLiveQuery(
    () => (user ? postService.byUser(user.id, user.id) : undefined),
    [user?.id],
  )
  const stories = useLiveQuery(
    async () => (user ? (await storyService.live()).filter((s) => s.userId === user.id) : undefined),
    [user?.id],
  )
  const sessions = useLiveQuery(
    () => (user ? workoutService.sessionsForUser(user.id) : undefined),
    [user?.id],
  )
  const weights = useLiveQuery(
    () => (user ? weightService.listWeekly(user.id) : undefined),
    [user?.id],
  )
  const achievements = useLiveQuery(
    () => (user ? achievementService.listForUser(user.id) : undefined),
    [user?.id],
  )

  if (!user || posts === undefined) return <LoadingScreen />

  const officials = withDeltas(weights ?? []).slice(0, 6)
  const unlocked = (achievements ?? []).filter((a) => a.unlockedAt)

  return (
    <div className={styles.page}>
      <PageHeader title="My records" subtitle="Everything you have shared and logged" parent={{ label: 'Me', to: '/me' }} />

      <div className={styles.tabs} role="tablist" aria-label="My records">
        {(['posts', 'fitness'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={[styles.tab, tab === value ? styles.tabOn : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(value)}
          >
            {value === 'posts' ? 'Posts' : 'Fitness'}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        <>
          <Section title={`Posts (${posts.length})`}>
            {posts.length > 0 ? (
              <ul className={styles.feed}>
                {posts.map((post) => (
                  <li key={post.id}>
                    <PostCard post={post} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                title="Nothing posted yet"
                body="Anything you share with the group shows up here."
              />
            )}
          </Section>

          <Section title={`Live stories (${stories?.length ?? 0})`}>
            {stories && stories.length > 0 ? (
              <ul className={styles.stories}>
                {stories.map((story) => (
                  <li key={story.id} className={styles.story}>
                    <span className={styles.storyType}>{story.type}</span>
                    <span className={styles.storyText}>{story.text || 'Shared progress'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                title="No live stories"
                body="Stories disappear after 24 hours, so this empties itself."
              />
            )}
          </Section>
        </>
      ) : (
        <>
          <Section
            title="Workout logs"
            action={
              <Link to="/workout/logs" className={styles.sectionLink}>
                All logs
              </Link>
            }
          >
            {sessions && sessions.length > 0 ? (
              <ul className={styles.logs}>
                {sessions.slice(0, 5).map((session) => (
                  <li key={session.id}>
                    <SessionCard session={session} showDate />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No workouts yet" body="Log one and it lands here." />
            )}
          </Section>

          <Section
            title="Weigh-ins"
            action={
              <Link to="/progress" className={styles.sectionLink}>
                Progress
              </Link>
            }
          >
            {officials.length > 0 ? (
              <ul className={styles.weighIns}>
                {officials.map(({ entry, changeKg }) => (
                  <li key={entry.id} className={styles.weighIn}>
                    <span className={styles.weighDate}>{formatDay(entry.date)}</span>
                    <span className={`tnum ${styles.weighValue}`}>{num(entry.weightKg, 1)} kg</span>
                    <span className={styles.weighChange}>
                      {changeKg === undefined ? '—' : `${signed(changeKg)} kg`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No weigh-ins yet" body="Your weekly weight lands here." />
            )}
          </Section>

          <Section
            title={`Achievements (${unlocked.length})`}
            action={
              <Link to="/group/awards" className={styles.sectionLink}>
                All
              </Link>
            }
          >
            {unlocked.length > 0 ? (
              <AchievementGrid achievements={unlocked.slice(0, 6)} />
            ) : (
              <EmptyState compact title="Nothing unlocked yet" body="They arrive as you log." />
            )}
          </Section>
        </>
      )}
    </div>
  )
}
