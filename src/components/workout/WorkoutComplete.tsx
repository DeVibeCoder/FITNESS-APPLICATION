import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import type { Difficulty } from '@/models'
import { duration, kcal } from '@/utils/format'
import styles from './WorkoutComplete.module.css'

interface WorkoutCompleteProps {
  dayNumber?: number
  name: string
  exerciseCount: number
  caloriesKcal: number
  durationSec: number
  /** Exercises the user chose to skip, acknowledged without judgement. */
  skipped?: number
  saving: boolean
  onFinish: (difficulty?: Difficulty, note?: string) => void
}

/**
 * The moment the app exists for. Full screen, big numbers, one question, one
 * button — and the only place with a celebratory animation.
 */
export function WorkoutComplete({
  dayNumber,
  name,
  exerciseCount,
  caloriesKcal,
  durationSec,
  skipped = 0,
  saving,
  onFinish,
}: WorkoutCompleteProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>()
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)

  return createPortal(
    <div className={styles.screen} role="dialog" aria-modal="true" aria-label="Workout finished">
      <div className={styles.inner}>
        <div className={styles.headline}>
          <p className={styles.kicker}>Workout</p>
          <h1 className={styles.title}>
            Finished! <span aria-hidden="true">🎉</span>
          </h1>
        </div>

        <div className={styles.session}>
          {dayNumber ? <p className={styles.day}>Day {dayNumber}</p> : null}
          <p className={styles.name}>{name}</p>
        </div>

        <dl className={styles.stats}>
          <div>
            <dd className="tnum">{exerciseCount}</dd>
            <dt>Exercises</dt>
          </div>
          <div>
            <dd className="tnum">{duration(durationSec)}</dd>
            <dt>Time</dt>
          </div>
          <div>
            <dd className="tnum">{kcal(caloriesKcal, 1)}</dd>
            <dt>Est. kcal</dt>
          </div>
        </dl>

        {skipped > 0 ? (
          <p className={styles.skipped}>
            {skipped} {skipped === 1 ? 'exercise' : 'exercises'} skipped — still counts.
          </p>
        ) : null}

        <div className={styles.feedback}>
          <p className={styles.question}>How did that feel?</p>
          <div className={styles.options}>
            {DIFFICULTY_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={[styles.option, difficulty === option.value ? styles.optionActive : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setDifficulty(option.value)}
                aria-pressed={difficulty === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          {noteOpen ? (
            <input
              className={styles.note}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Felt harder than yesterday…"
              maxLength={140}
              aria-label="Workout note"
              autoFocus
            />
          ) : (
            <button className={styles.noteToggle} onClick={() => setNoteOpen(true)}>
              Add a note
            </button>
          )}
        </div>

        <button
          className={styles.finish}
          onClick={() => onFinish(difficulty, note)}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Finish'}
        </button>
        <p className={styles.footnote}>
          Calories are an estimate based on your weight and the length of the session.
        </p>
      </div>
    </div>,
    document.body,
  )
}
