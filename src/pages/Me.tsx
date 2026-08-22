import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Cog, Layers, LogOut, Quote, Shield, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/context/AuthContext'
import { accountService, hasRole, postService, progressService, storyService } from '@/services'
import { goalLabel } from '@/utils/calories'
import { goalProfile } from '@/utils/goals'
import { todayKey } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './Me.module.css'

/**
 * Everything personal, in one place.
 *
 * Who you are and what you are working toward at the top, then the things you
 * have posted, then the fitness records that belong to you alone. The detailed
 * screens are unchanged and linked from here — this page organises them, it
 * does not replace them.
 */
export function Me() {
  const { user, signOut } = useAuth()
  const today = todayKey()

  const me = useLiveQuery(
    () => (user ? progressService.userSnapshot(user.id, today) : undefined),
    [user?.id, today],
  )
  const posts = useLiveQuery(
    () => (user ? postService.byUser(user.id, user.id) : undefined),
    [user?.id],
  )
  const stories = useLiveQuery(
    async () => (user ? (await storyService.live()).filter((s) => s.userId === user.id) : undefined),
    [user?.id],
  )
  // Only an admin ever asks for this, and only to size the badge.
  const pendingCount = useLiveQuery(
    () => (hasRole(user, 'admin') ? accountService.pendingCount() : undefined),
    [user?.id, user?.role],
  )

  if (!user || !me) return <LoadingScreen />

  const profile = goalProfile(user.goal)
  const isAdmin = hasRole(user, 'admin')

  return (
    <div className={styles.page}>
      <PageHeader title="Me" subtitle={`@${user.handle}`} />

      <header className={`glass ${styles.identity}`}>
        <Avatar user={user} size="xl" ring={me.streak >= 7} />
        <div className={styles.identityText}>
          <h2 className={styles.name}>{user.name}</h2>
          <span className={styles.goal}>{goalLabel(user.goal)}</span>
          <p className={styles.journey}>
            <span className="tnum">{num(user.startWeightKg, 1)}</span>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <span className={`tnum ${styles.now}`}>{num(me.currentWeightKg, 1)}</span>
            <span className={styles.unit}>kg</span>
          </p>
          {profile.usesTargetWeight ? (
            <p className={styles.target}>
              <span className="tnum">{num(user.targetWeightKg, 1)} kg</span> goal
            </p>
          ) : (
            <p className={styles.target}>{profile.tagline}</p>
          )}
        </div>
      </header>

      <dl className={styles.stats}>
        <div>
          <dt>Streak</dt>
          <dd className="tnum">{me.streak}</dd>
        </div>
        <div>
          <dt>Awards</dt>
          <dd className="tnum">{me.achievements}</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd className="tnum">{posts?.length ?? 0}</dd>
        </div>
        <div>
          <dt>Stories</dt>
          <dd className="tnum">{stories?.length ?? 0}</dd>
        </div>
      </dl>

      {/*
        Me is identity and settings now. What this person posted and logged
        lives in My records, and the fitness screens live in Activity — the
        same feature appearing in three places was the problem this fixes.

        There is no Achievements row. Profile & goals already ends in the full
        set, and Group → Awards is where they are compared — a third entry
        pointing at the same grid made Me look longer than it is.
      */}
      <Section title="You">
        <ul className={styles.links}>
          <Row to="/me/activity" icon={<Layers size={17} strokeWidth={2} />} label="My records" hint="Your posts, logs, weigh-ins and awards" />
          <Row
            to="/profile"
            icon={<Cog size={17} strokeWidth={2} />}
            label="Profile & goals"
            hint={`Name, goal, targets, weigh-in day · ${me.achievements} achievements`}
          />
          <Row to="/motivation" icon={<Quote size={17} strokeWidth={2} />} label="Motivation" hint="This week's video and the collection" />
        </ul>
      </Section>

      <Section title="Settings">
        <ul className={styles.links}>
          {/*
            One row, one destination. Privacy & data and Appearance were two
            rows opening the same screen.
          */}
          <Row
            to="/more"
            icon={<Shield size={17} strokeWidth={2} />}
            label="Settings"
            hint="Privacy, appearance, media and your data"
          />
          {isAdmin ? (
            <Row
              to="/me/admin"
              icon={<ShieldCheck size={17} strokeWidth={2} />}
              label="Admin"
              hint={pendingCount ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} waiting` : 'Approve people who ask to join'}
            />
          ) : null}
        </ul>
      </Section>

      <Button variant="ghost" icon={<LogOut size={15} strokeWidth={2.2} />} onClick={signOut}>
        Sign out
      </Button>
    </div>
  )
}

function Row({
  to,
  icon,
  label,
  hint,
}: {
  to: string
  icon: React.ReactNode
  label: string
  hint: string
}) {
  return (
    <li>
      <Link to={to} className={styles.link}>
        <span className={styles.linkIcon}>{icon}</span>
        <span className={styles.linkText}>
          <span className={styles.linkLabel}>{label}</span>
          <span className={styles.linkHint}>{hint}</span>
        </span>
        <ChevronRight size={17} strokeWidth={2} className={styles.chevron} />
      </Link>
    </li>
  )
}
