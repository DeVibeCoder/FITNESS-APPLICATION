import { useLiveQuery } from 'dexie-react-hooks'
import { Avatar } from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { challengeService , userService } from '@/services'
import { formatRange, todayKey } from '@/utils/date'
import { firstName, num } from '@/utils/format'
import styles from './ChallengeCard.module.css'

/**
 * One shared target a week.
 *
 * The board is ordered — a list of three is quicker to read when the biggest
 * number is at the top — but it is still not a competition: everyone's figure
 * feeds one bar, the bar is what completes, and nobody is ever told they came
 * last. Somebody sitting the week out is named rather than deleted, because a
 * per-member target that quietly shrank would be the more confusing of the
 * two.
 */
export function ChallengeCard() {
  const today = todayKey()
  const progress = useLiveQuery(() => challengeService.progress(today), [today])
  const users = useLiveQuery(() => userService.listMembers(), [])

  if (!progress || !users) return null

  const { challenge, contributions, sittingOut, total, target, pct, complete, daysLeft } = progress
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
          {/*
            When it runs, and how much of it is left. Both dates come from the
            challenge's own week rather than from today, so the range is right
            even on the Sunday the week turns over.
          */}
          <p className={styles.when}>
            {formatRange(progress.startDate, progress.endDate)}
            {' · '}
            <span className={daysLeft <= 2 ? styles.urgent : undefined}>
              {daysLeft} day{daysLeft === 1 ? '' : 's'} left
            </span>
          </p>
        </div>
      </header>

      {complete ? (
        <p className={styles.done}>Group goal reached 🎉 Everyone taking part contributed.</p>
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

      {contributions.length === 0 ? (
        <p className={styles.nobody}>
          Nobody is taking part this week. Join in and the board starts counting.
        </p>
      ) : (
        <ul className={styles.people}>
          {contributions.map((row) => {
            const person = byId.get(row.userId)
            if (!person) return null
            return (
              <li key={row.userId} className={styles.person}>
                <span className={styles.rank} aria-hidden="true">
                  {row.rank}
                </span>
                <Avatar user={person} size="xs" />
                <span className={styles.name}>{firstName(person.name)}</span>
                <span
                  className={[styles.value, row.met ? styles.met : ''].filter(Boolean).join(' ')}
                >
                  <span className="tnum">{num(row.value)}</span>
                  {challenge.perMember ? (
                    <span className={styles.of}>/{challenge.target}</span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {sittingOut.length > 0 ? (
        <p className={styles.sittingOut}>
          Sitting this one out:{' '}
          {sittingOut
            .map((id) => firstName(byId.get(id)?.name ?? 'Someone'))
            .join(', ')}
        </p>
      ) : null}
    </section>
  )
}
