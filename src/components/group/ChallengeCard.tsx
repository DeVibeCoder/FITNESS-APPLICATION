import { useLiveQuery } from 'dexie-react-hooks'
import { Avatar } from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { challengeService , userService } from '@/services'
import { todayKey } from '@/utils/date'
import { firstName, num } from '@/utils/format'
import styles from './ChallengeCard.module.css'

/**
 * One shared target a week.
 *
 * Everyone's contribution is shown, but nobody is ranked and there is no
 * winner — the point is that the bar fills because three people all did
 * something, not that one of them did the most.
 */
export function ChallengeCard() {
  const today = todayKey()
  const progress = useLiveQuery(() => challengeService.progress(today), [today])
  const users = useLiveQuery(() => userService.listMembers(), [])

  if (!progress || !users) return null

  const { challenge, contributions, total, target, pct, complete } = progress
  const byId = new Map(users.map((u) => [u.id, u]))

  return (
    <section
      className={[`glass`, styles.card, complete ? styles.complete : ''].filter(Boolean).join(' ')}
      aria-labelledby="challenge-title"
    >
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          {challenge.icon}
        </span>
        <div className={styles.headText}>
          <h3 id="challenge-title" className={styles.title}>
            {challenge.title}
          </h3>
          <p className={styles.blurb}>{challenge.blurb}</p>
        </div>
      </header>

      {complete ? (
        <p className={styles.done}>Group goal reached 🎉 Everyone contributed.</p>
      ) : null}

      <div className={styles.bar}>
        <ProgressBar
          value={total}
          max={target}
          label={`${challenge.title}: ${pct}% complete`}
          tone={complete ? 'success' : 'accent'}
        />
        {/* The running total leads; the target is context, not competition. */}
        <p className={styles.tally}>
          <span className="tnum">{num(total)}</span>
          <em>
            {' '}
            of <span className="tnum">{num(target)}</span> {challenge.unit}
          </em>
        </p>
      </div>

      <ul className={styles.people}>
        {contributions.map((row) => {
          const person = byId.get(row.userId)
          if (!person) return null
          return (
            <li key={row.userId} className={styles.person}>
              <Avatar user={person} size="xs" />
              <span className={styles.name}>{firstName(person.name)}</span>
              <span className={[styles.value, row.met ? styles.met : ''].filter(Boolean).join(' ')}>
                <span className="tnum">{num(row.value)}</span>
                {challenge.perMember ? <span className={styles.of}>/{challenge.target}</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
