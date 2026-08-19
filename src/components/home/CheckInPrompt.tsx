import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { checkinService, ENERGY_OPTIONS, MOOD_OPTIONS } from '@/services/checkinService'
import type { DailyCheckIn } from '@/models'
import { todayKey } from '@/utils/date'
import styles from './CheckInPrompt.module.css'

interface CheckInPromptProps {
  /** Today's check-in, if it has already been done. */
  checkIn?: DailyCheckIn
  onOpenFull: () => void
}

/**
 * A one-tap check-in. Picking a mood saves immediately with sensible defaults;
 * the full form (energy, soreness, note) is one tap further. Once done it
 * collapses to a quiet confirmation rather than disappearing, so the day still
 * reads as complete.
 */
export function CheckInPrompt({ checkIn, onOpenFull }: CheckInPromptProps) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [saving, setSaving] = useState<number | null>(null)

  if (!user) return null

  if (checkIn) {
    const mood = MOOD_OPTIONS.find((option) => option.value === checkIn.mood)
    const energy = ENERGY_OPTIONS.find((option) => option.value === checkIn.energy)
    return (
      <Card className={styles.doneCard}>
        <span className={styles.doneEmoji} aria-hidden="true">
          {mood?.emoji ?? '🙂'}
        </span>
        <span className={styles.doneText}>
          <span className={styles.doneTitle}>Thanks for checking in.</span>
          <span className={styles.doneMeta}>
            {mood?.label ?? 'Checked in'}
            {energy ? ` · energy ${energy.label.toLowerCase()}` : ''}
            {checkIn.soreness !== 'none' ? ` · ${checkIn.soreness} soreness` : ''}
          </span>
        </span>
        <button className={styles.change} onClick={onOpenFull}>
          Change
        </button>
      </Card>
    )
  }

  const pick = async (mood: DailyCheckIn['mood']) => {
    setSaving(mood)
    const result = await guard(() =>
      checkinService.save({
        userId: user.id,
        date: todayKey(),
        // Energy tracks mood unless the person opens the full form and says otherwise.
        energy: Math.max(1, Math.min(4, mood - 1)) as DailyCheckIn['energy'],
        mood,
        soreness: 'none',
      }),
    )
    setSaving(null)
    if (result !== undefined) show('Thanks for checking in.', 'success')
  }

  return (
    <Card className={styles.card}>
      <div className={styles.text}>
        <p className={styles.title}>How are you feeling today?</p>
        <button className={styles.more} onClick={onOpenFull}>
          Add energy and soreness
        </button>
      </div>
      <div className={styles.moods}>
        {MOOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={styles.mood}
            onClick={() => pick(option.value)}
            disabled={saving !== null}
            aria-label={option.label}
            title={option.label}
          >
            <span aria-hidden="true">{option.emoji}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
