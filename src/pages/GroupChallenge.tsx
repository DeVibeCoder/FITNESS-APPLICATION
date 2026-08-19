import { useLiveQuery } from 'dexie-react-hooks'
import { Share2 } from 'lucide-react'
import { Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ChallengeCard } from '@/components/group/ChallengeCard'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { challengeService, chatService } from '@/services'
import { formatRange, todayKey, endOfWeek } from '@/utils/date'
import styles from './GroupChallenge.module.css'

/**
 * This week's shared target, on its own page so it can be linked to from the
 * chat and from Home without either of them having to carry the whole thing.
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

  if (!user || challenge === undefined) return <LoadingScreen />
  if (challenge === null) {
    return (
      <div className={styles.page}>
        <h2 className={styles.heading}>This week's challenge</h2>
        <p className={styles.note}>No challenge is running this week. One starts every Sunday.</p>
      </div>
    )
  }

  const shareToChat = async () => {
    const result = await guard(() => chatService.shareChallenge(user.id, challenge.id))
    if (result) show('Posted to the group chat.', 'success')
  }

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h2 className={styles.heading}>This week's challenge</h2>
        <p className={styles.range}>{formatRange(challenge.weekStart, endOfWeek(today))}</p>
      </div>

      <Section title="Together">
        <ChallengeCard />
      </Section>

      <Button
        variant="secondary"
        icon={<Share2 size={15} strokeWidth={2.1} />}
        onClick={shareToChat}
      >
        Share progress to chat
      </Button>

      <p className={styles.note}>
        A new challenge starts every Sunday. Progress is worked out from what everyone has already
        logged — there is nothing extra to record.
      </p>
    </div>
  )
}
