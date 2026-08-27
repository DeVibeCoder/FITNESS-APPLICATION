import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { PenLine } from 'lucide-react'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StoriesRail } from '@/components/social/StoriesRail'
import { PostCard } from '@/components/social/PostCard'
import { GroupList } from '@/components/group/GroupList'
import { MemberSheet } from '@/components/group/MemberSheet'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { postService, progressService } from '@/services'
import { formatFullDate, greeting, todayKey } from '@/utils/date'
import { firstName } from '@/utils/format'
import { encouragementLine } from '@/data/messages'
import styles from './Home.module.css'

/**
 * Home is the feed. Only the feed.
 *
 * Greeting, stories, a prompt to post, then posts — and nothing pinned below
 * them. That last part is the constraint that matters: a feed grows, so
 * anything parked underneath it drifts further out of reach with every post.
 * Group, Chat, Progress and Activity are all one tap away in the bottom bar,
 * which is a fixed distance no matter how much the group has been talking.
 *
 * The desktop rail is the exception, and only because it sits beside the feed
 * rather than after it.
 *
 * The feed is live: the prompt opens the composer, new posts appear here the
 * moment they are written, and reacting and commenting happen on the card.
 * Stories are still the rail's own phase.
 */
export function Home() {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const today = todayKey()
  // The rail's rows open a panel over Home rather than sending someone to a
  // member page — the same rule Group follows, for the same list.
  const [selected, setSelected] = useState<string | null>(null)

  const posts = useLiveQuery(() => (user ? postService.feed(user.id) : undefined), [user?.id])
  // Desktop rail only; the mobile layout never renders it.
  const group = useLiveQuery(() => progressService.groupSnapshot(today), [today])

  if (!user || posts === undefined) return <LoadingScreen />

  return (
    <div className={styles.page}>
      <header className={styles.greeting}>
        <h2 className={styles.hello}>
          {greeting()}, {firstName(user.name)} <span aria-hidden="true">👋</span>
        </h2>
        <p className={styles.date}>
          {formatFullDate(today)} · {encouragementLine(user.id, today)}
        </p>
      </header>

      <StoriesRail />

      {/*
        No shortcut strip under the stories. Group, Chat and Challenge each
        have a real destination now — three chips repeating what the bottom bar
        already offers were costing the feed its first screen and nothing else.
      */}
      <div className={styles.columns}>
        <div className={styles.main}>
          {/* The one prompt on the screen: say something. */}
          <button className={`glass ${styles.composer}`} onClick={() => open('post')}>
            <span className={styles.composerIcon}>
              <PenLine size={16} strokeWidth={2.2} />
            </span>
            <span className={styles.composerText}>Share something with the group…</span>
          </button>

          {posts.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Nothing here yet.</p>
              <p className={styles.emptyBody}>
                When someone posts, it shows up here for the three of you.
              </p>
              <Button onClick={() => open('post')}>Write the first one</Button>
            </div>
          ) : (
            <ul className={styles.feed}>
              {posts.map((post) => (
                <li key={post.id}>
                  <PostCard post={post} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          Desktop only, and beside the feed rather than after it.

          One section, and it is live group data — who is in the group and how
          they are tracking. The challenge card and the motivation card that
          used to sit under it are gone: the challenge is already the Group
          tab's own section, and a rotating quote is decoration, not
          information. A sidebar filled to avoid looking empty makes Home busy
          without making it useful.
        */}
        <aside className={styles.rail}>
          <Section
            title="Our group"
            action={
              <Link to="/group" className={styles.sectionLink}>
                Open
              </Link>
            }
          >
            {group ? (
              <GroupList members={group} currentUserId={user.id} onSelect={setSelected} />
            ) : null}
          </Section>
        </aside>
      </div>

      <MemberSheet userId={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
