import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { checkinService, ENERGY_OPTIONS, FEELING_OPTIONS, feelingFor, MOOD_OPTIONS } from '@/services/checkinService'
import type { DailyCheckIn } from '@/models'
import { todayKey } from '@/utils/date'
import styles from './CheckInPrompt.module.css'

interface CheckInPromptProps {
  /** Today's check-in, if it has already been done. */
  checkIn?: DailyCheckIn
  onOpenFull: () => void
}

/**
 * A one-tap check-in. Picking a feeling saves immediately — mood, energy and
 * soreness all written from the one choice — and the full form (which can say
 * things the five options cannot) is one tap further. Once done it collapses
 * to a quiet confirmation rather than disappearing, so the day still reads as
 * complete.
 *
 * There is exactly one check-in record per person per day, and this writes the
 * same one the full form does. Tapping a different feeling later corrects it.
 */
export function CheckInPrompt({ checkIn, onOpenFull }: CheckInPromptProps) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [saving, setSaving] = useState<string | null>(null)

  if (!user) return null

  if (checkIn) {
    const feeling = feelingFor(checkIn)
    const mood = MOOD_OPTIONS.find((option) => option.value === checkIn.mood)
    const energy = ENERGY_OPTIONS.find((option) => option.value === checkIn.energy)
    return (
      <Card className={styles.doneCard}>
        <span className={styles.doneEmoji} aria-hidden="true">
          {feeling?.emoji ?? mood?.emoji ?? '🙂'}
        </span>
        <span className={styles.doneText}>
          <span className={styles.doneTitle}>Thanks for checking in.</span>
          <span className={styles.doneMeta}>
            {feeling?.label ?? mood?.label ?? 'Checked in'}
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

  const pick = async (option: (typeof FEELING_OPTIONS)[number]) => {
    setSaving(option.key)
    const result = await guard(() =>
      checkinService.save({
        userId: user.id,
        date: todayKey(),
        energy: option.energy,
        mood: option.mood,
        soreness: option.soreness,
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
        {FEELING_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={styles.mood}
            onClick={() => pick(option)}
            disabled={saving !== null}
            aria-label={option.label}
          >
            <span className={styles.moodEmoji} aria-hidden="true">
              {option.emoji}
            </span>
            <span className={styles.moodLabel}>{option.label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
