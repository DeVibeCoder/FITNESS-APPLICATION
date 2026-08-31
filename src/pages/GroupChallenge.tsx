import { useLiveQuery } from 'dexie-react-hooks'
import { LogIn, LogOut, Share2 } from 'lucide-react'
import { Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { ChallengeCard } from '@/components/group/ChallengeCard'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { challengeService, chatService } from '@/services'
import type { ChallengeProgress } from '@/models'
import { formatRange, todayKey } from '@/utils/date'
import styles from './GroupChallenge.module.css'

/**
 * This week's shared target, on its own page so it can be linked to from the
 * chat and from Home without either of them having to carry the whole thing.
 *
 * Three states, deliberately different from one another rather than one screen
 * with pieces missing: still loading, no challenge running, and a challenge to
 * take part in. Underneath, the weeks already finished — a target the group
 * hit is worth keeping, and one it missed is worth seeing too.
 */
export function GroupChallenge() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const today = todayKey()
  // `undefined` is still loading; `null` means there genuinely isn't one, and
  // the two must not look the same or the page spins forever.
  const challenge = useLiveQuery(
    async () => (await challengeService.forWeek(today)) ?? null,
    [today],
  )
  const takingPart = useLiveQuery(
    async () =>
      user && challenge ? challengeService.isTakingPart(challenge.id, user.id) : undefined,
    [user?.id, challenge?.id],
  )
  const past = useLiveQuery(() => challengeService.history(today), [today])

  if (!user || challenge === undefined) return <LoadingScreen />
  if (challenge === null) {
    return (
      <div className={styles.page}>
        <h2 className={styles.heading}>This week's challenge</h2>
        <EmptyState
          compact
          title="No challenge this week"
          body="A new one starts every Sunday. Anything you log before then still counts toward it."
        />
        {past && past.length > 0 ? <PastChallenges past={past} /> : null}
      </div>
    )
  }

  const shareToChat = async () => {
    const result = await guard(() => chatService.shareChallenge(user.id, challenge.id))
    if (result) show('Posted to the group chat.', 'success')
  }

  /*
   * Sitting out is not leaving the group and it deletes nothing — it takes
   * this person off this week's board, which is the honest thing to do when
   * somebody is away or injured and a per-member target would otherwise stand
   * permanently a third short.
   */
  const toggleTakingPart = async () => {
    if (takingPart === undefined) return
    const done = await guard(async () => {
      if (takingPart) await challengeService.leave(challenge.id, user.id)
      else await challengeService.join(challenge.id, user.id)
      return true
    })
    if (!done) return
    show(takingPart ? "You're sitting this one out." : "You're back in.", 'success')
  }

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h2 className={styles.heading}>This week's challenge</h2>
      </div>

      <Section title="Together">
        <ChallengeCard />
      </Section>

      <div className={styles.actions}>
        <Button
          variant={takingPart ? 'ghost' : 'primary'}
          icon={
            takingPart ? (
              <LogOut size={15} strokeWidth={2.1} />
            ) : (
              <LogIn size={15} strokeWidth={2.1} />
            )
          }
          disabled={takingPart === undefined}
          onClick={toggleTakingPart}
        >
          {takingPart ? 'Sit this one out' : 'Join the challenge'}
        </Button>

        <Button
          variant="secondary"
          icon={<Share2 size={15} strokeWidth={2.1} />}
          onClick={shareToChat}
        >
          Share progress to chat
        </Button>
      </div>

      <p className={styles.note}>
        A new challenge starts every Sunday. Progress is worked out from what everyone has already
        logged — there is nothing extra to record.
      </p>

      {past && past.length > 0 ? <PastChallenges past={past} /> : null}
    </div>
  )
}

/**
 * The weeks already finished.
 *
 * One line each rather than a second board: what it was, when it ran, how
 * close it came and whether it landed. Read through the same service the live
 * one is, so nothing here is a stored summary that can disagree with the
 * records behind it.
 */
function PastChallenges({ past }: { past: ChallengeProgress[] }) {
  return (
    <Section title="Finished weeks">
      <ul className={styles.past}>
        {past.map((row) => (
          <li key={row.challenge.id} className={styles.pastRow}>
            <span className={styles.pastIcon} aria-hidden="true">
              {row.challenge.icon}
            </span>
            <span className={styles.pastText}>
              <span className={styles.pastTitle}>{row.challenge.title}</span>
              <span className={styles.pastMeta}>
                {formatRange(row.startDate, row.endDate)} · {row.pct}% of target
              </span>
            </span>
            <span
              className={[styles.pastState, row.complete ? styles.pastDone : '']
                .filter(Boolean)
                .join(' ')}
            >
              {row.complete ? 'Completed' : 'Missed'}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
