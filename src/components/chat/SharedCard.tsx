import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { ProgressBar } from '@/components/ui/Progress'
import { ACHIEVEMENT_BY_KEY } from '@/data/achievements'
import { workoutAppLabel } from '@/data/workoutApps'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import { challengeService } from '@/services'
import type { ChatMessage, User } from '@/models'
import { num, signed } from '@/utils/format'
import { duration } from '@/utils/format'
import { firstName } from '@/utils/format'
import styles from './SharedCard.module.css'

/**
 * The structured card behind a share.
 *
 * A message stores only the id of what it points at, so these read the record
 * live. Correcting a workout updates the card that announced it, and deleting
 * one leaves an honest "no longer available" rather than a frozen copy of
 * something that is gone.
 *
 * The prop takes only the two fields it reads, so a post renders the same card
 * as a chat message without either of them knowing about the other.
 */
type Shareable = Pick<ChatMessage, 'sharedType' | 'sharedDataId'>

export function SharedCard({ message, author }: { message: Shareable; author: User }) {
  switch (message.sharedType) {
    case 'workout':
      return <WorkoutShare id={message.sharedDataId} author={author} />
    case 'weigh_in':
      return <WeighInShare id={message.sharedDataId} author={author} />
    case 'steps':
      return <StepsShare id={message.sharedDataId} author={author} />
    case 'achievement':
      return <AchievementShare achievementKey={message.sharedDataId} author={author} />
    case 'challenge':
      return <ChallengeShare id={message.sharedDataId} />
    default:
      return null
  }
}

function Missing({ what }: { what: string }) {
  return <p className={styles.missing}>That {what} is no longer available.</p>
}

function WorkoutShare({ id, author }: { id?: string; author: User }) {
  const session = useLiveQuery(() => (id ? db.sessions.get(id) : undefined), [id])
  if (id && session === undefined) return <p className={styles.loading}>Loading…</p>
  if (!session) return <Missing what="workout" />

  const feeling = DIFFICULTY_OPTIONS.find((o) => o.value === session.difficulty)?.label

  return (
    <div className={`glass ${styles.card}`}>
      <p className={styles.kicker}>{firstName(author.name)} completed a workout</p>
      <p className={styles.app}>{workoutAppLabel(session.source, session.sourceName)}</p>
      <p className={styles.headline}>
        {session.dayNumber ? `Day ${session.dayNumber} · ` : ''}
        {session.planName || session.name}
      </p>
      <p className={styles.facts}>
        <span className="tnum">{duration(session.durationSec)}</span> ·{' '}
        <span className="tnum">{num(session.caloriesKcal, 0)}</span> kcal
        {feeling ? ` · ${feeling}` : ''}
      </p>
      <Link to="/workout/logs" className={styles.action}>
        View
      </Link>
    </div>
  )
}

function WeighInShare({ id, author }: { id?: string; author: User }) {
  const entry = useLiveQuery(() => (id ? db.weights.get(id) : undefined), [id])
  /**
   * The previous official weigh-in, only so the week's change can be shown.
   * Nothing else from the history is read and none of it is rendered.
   */
  const previous = useLiveQuery(async () => {
    if (!entry) return undefined
    const officials = (await db.weights.where('userId').equals(entry.userId).sortBy('date')).filter(
      (row) => row.kind === 'official' && row.date < entry.date,
    )
    return officials.at(-1)
  }, [entry?.id, entry?.date, entry?.userId])

  if (id && entry === undefined) return <p className={styles.loading}>Loading…</p>
  if (!entry) return <Missing what="weigh-in" />

  const changeKg = previous ? Math.round((entry.weightKg - previous.weightKg) * 10) / 10 : undefined

  return (
    <div className={`glass ${styles.card}`}>
      <p className={styles.kicker}>{firstName(author.name)} shared a weekly weigh-in</p>
      <p className={styles.big}>
        <span className="tnum">{num(entry.weightKg, 1)}</span>
        <span className={styles.unit}>kg</span>
      </p>
      {changeKg === undefined ? (
        <p className={styles.facts}>First official weigh-in</p>
      ) : (
        <p className={styles.facts}>
          <span className="tnum">{signed(changeKg)} kg</span> this week{changeKg < 0 ? ' 🔥' : ''}
        </p>
      )}
    </div>
  )
}

function StepsShare({ id, author }: { id?: string; author: User }) {
  const entry = useLiveQuery(() => (id ? db.steps.get(id) : undefined), [id])
  const owner = useLiveQuery(() => (entry ? db.users.get(entry.userId) : undefined), [entry?.userId])

  if (id && entry === undefined) return <p className={styles.loading}>Loading…</p>
  if (!entry) return <Missing what="step count" />

  const goal = owner?.stepGoal ?? 0
  const hit = goal > 0 && entry.steps >= goal

  return (
    <div className={`glass ${styles.card}`}>
      <p className={styles.kicker}>
        {firstName(author.name)} {hit ? "reached today's step goal 🚶" : 'shared their steps 🚶'}
      </p>
      <p className={styles.headline}>
        <span className="tnum">{num(entry.steps)}</span>
        {goal > 0 ? <span className={styles.of}> / {num(goal)}</span> : null}
      </p>
      {goal > 0 ? <ProgressBar value={entry.steps} max={goal} label="Steps against goal" /> : null}
    </div>
  )
}

function AchievementShare({ achievementKey, author }: { achievementKey?: string; author: User }) {
  const def = achievementKey ? ACHIEVEMENT_BY_KEY.get(achievementKey) : undefined
  if (!def) return <Missing what="achievement" />

  return (
    <div className={`glass ${styles.card} ${styles.achievement}`}>
      <span className={styles.medal} aria-hidden="true">
        {def.icon}
      </span>
      <div>
        <p className={styles.kicker}>{firstName(author.name)} unlocked</p>
        <p className={styles.headline}>{def.title}</p>
        <p className={styles.facts}>{def.description}</p>
      </div>
    </div>
  )
}

function ChallengeShare({ id }: { id?: string }) {
  const challenge = useLiveQuery(() => (id ? db.challenges.get(id) : undefined), [id])
  const progress = useLiveQuery(
    () => (challenge ? challengeService.progress(challenge.weekStart) : undefined),
    [challenge?.weekStart],
  )

  if (id && challenge === undefined) return <p className={styles.loading}>Loading…</p>
  if (!challenge) return <Missing what="challenge" />

  return (
    <div className={`glass ${styles.card}`}>
      <p className={styles.kicker}>{challenge.icon} Group challenge update</p>
      <p className={styles.headline}>{challenge.title}</p>
      {progress ? (
        <>
          <ProgressBar
            value={progress.total}
            max={progress.target}
            label={`${challenge.title} progress`}
            tone={progress.complete ? 'success' : 'accent'}
          />
          <p className={styles.facts}>
            <span className="tnum">{num(progress.total)}</span> /{' '}
            <span className="tnum">{num(progress.target)}</span> {challenge.unit}
          </p>
        </>
      ) : null}
      <Link to="/group/challenge" className={styles.action}>
        View
      </Link>
    </div>
  )
}
