import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { Lock, X } from 'lucide-react'
import { ProgressBar } from '@/components/ui/Progress'
import type { AchievementView } from '@/services/achievementService'
import type { User } from '@/models'
import { formatDay, toDateKey } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './AwardDetail.module.css'

export interface AwardDetailData {
  achievement: AchievementView
  /** Who earned it, when the award is somebody else's. */
  earnedBy?: User
}

/**
 * One award, centred and large.
 *
 * The mark turns once as it lands — a half-second reveal, and the reason the
 * medal is worth tapping at all. It is a `transform` and an `opacity`, so it
 * composites rather than reflows, and `prefers-reduced-motion` removes it
 * entirely: the same panel simply appears.
 *
 * Nothing here decides whether an award is earned. The unlock state comes from
 * the stored rows, and a locked mark says how to get it rather than pretending
 * to be dimmed treasure.
 */
export function AwardDetail({
  data,
  onClose,
}: {
  /** `null` closes the overlay. */
  data: AwardDetailData | null
  onClose: () => void
}) {
  const titleId = useId()

  useEffect(() => {
    if (!data) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [data, onClose])

  if (!data) return null

  const { achievement, earnedBy } = data
  const unlocked = Boolean(achievement.unlockedAt)

  return createPortal(
    <div className={styles.root}>
      <button className={styles.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />

      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={2.2} />
        </button>

        <div
          className={[styles.medal, unlocked ? '' : styles.medalLocked].filter(Boolean).join(' ')}
          aria-hidden="true"
        >
          {unlocked ? achievement.icon : <Lock size={40} strokeWidth={1.8} />}
        </div>

        <h2 id={titleId} className={styles.title}>
          {achievement.title}
        </h2>
        <p className={styles.description}>{achievement.description}</p>

        <div className={[styles.reason, unlocked ? styles.reasonOn : ''].filter(Boolean).join(' ')}>
          <p className={styles.reasonLabel}>{unlocked ? 'Unlocked because' : 'How to earn it'}</p>
          <p className={styles.reasonBody}>{achievement.criteria}</p>
          {unlocked ? (
            <p className={styles.when}>
              {earnedBy ? `${earnedBy.name} · ` : ''}
              {formatDay(toDateKey(new Date(achievement.unlockedAt!)))}
            </p>
          ) : achievement.progress ? (
            /*
              How far along, for a mark that can be part-done. Read from the
              same measurements the unlock rule uses, so this is the actual
              distance left rather than an encouraging guess.
            */
            <div className={styles.towards}>
              <ProgressBar
                value={achievement.progress.current}
                max={achievement.progress.target}
                tone="accent"
                size="sm"
                label={`${achievement.title}: ${achievement.progress.pct}% of the way`}
              />
              <p className={styles.when}>
                <span className="tnum">
                  {num(achievement.progress.current, achievement.progress.current % 1 === 0 ? 0 : 1)}
                </span>{' '}
                of <span className="tnum">{num(achievement.progress.target)}</span>{' '}
                {achievement.progress.noun}
              </p>
            </div>
          ) : null}
        </div>

        <button className={styles.done} onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  )
}
