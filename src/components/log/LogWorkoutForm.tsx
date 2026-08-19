import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { achievementService, challengeService, workoutService } from '@/services'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import { WORKOUT_APPS } from '@/data/workoutApps'
import type { Difficulty, WorkoutSession, WorkoutSource } from '@/models'
import { todayKey } from '@/utils/date'
import { duration, parseDuration } from '@/utils/format'
import styles from './LogWorkoutForm.module.css'

/**
 * Logging a workout done somewhere else.
 *
 * This is the everyday path, so it is built for speed: the app, plan and day
 * are already filled in from last time, and everything else is copied straight
 * off the other app's summary screen. Ten to fifteen seconds, no exercise list.
 */
export function LogWorkoutForm({
  session,
  onDone,
}: {
  /** Editing an existing log rather than writing a new one. */
  session?: WorkoutSession
  onDone: () => void
}) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const temp = useTempImage()
  const fileInput = useRef<HTMLInputElement>(null)

  const [source, setSource] = useState<WorkoutSource>('home_workout')
  const [sourceName, setSourceName] = useState('')
  const [planName, setPlanName] = useState('')
  const [dayNumber, setDayNumber] = useState('')
  const [name, setName] = useState('')
  const [exerciseCount, setExerciseCount] = useState('')
  const [durationText, setDurationText] = useState('')
  const [calories, setCalories] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('just_right')
  const [note, setNote] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [saving, setSaving] = useState(false)

  /**
   * Editing loads the record; a new log borrows from the last one, with the
   * day number moved on. Runs once so it never overwrites typing.
   */
  useEffect(() => {
    if (prefilled || !user) return
    let cancelled = false

    const apply = async () => {
      if (session) {
        if (cancelled) return
        setSource(session.source ?? 'home_workout')
        setSourceName(session.sourceName ?? '')
        setPlanName(session.planName ?? '')
        setDayNumber(session.dayNumber ? String(session.dayNumber) : '')
        setName(session.name)
        setExerciseCount(String(session.exerciseCount))
        setDurationText(duration(session.durationSec))
        setCalories(String(session.caloriesKcal))
        setDifficulty(session.difficulty ?? 'just_right')
        setNote(session.note ?? '')
      } else {
        const defaults = await workoutService.quickLogDefaults(user.id)
        if (cancelled) return
        setSource(defaults.source)
        setSourceName(defaults.sourceName ?? '')
        setPlanName(defaults.planName ?? '')
        setDayNumber(defaults.dayNumber ? String(defaults.dayNumber) : '')
        setName(defaults.name ?? '')
        setExerciseCount(defaults.exerciseCount ? String(defaults.exerciseCount) : '')
      }
      setPrefilled(true)
    }

    void apply()
    return () => {
      cancelled = true
    }
  }, [user, session, prefilled])

  if (!user) return null

  const durationSec = parseDuration(durationText)
  const durationBad = durationText.trim().length > 0 && durationSec === null
  const valid = (name.trim() || planName.trim()) && durationSec !== null && durationSec > 0

  const attach = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      show("That file isn't a photo.", 'error')
      return
    }
    temp.set(file)
    // Clearing the input means picking the same file again still fires change.
    event.target.value = ''
  }

  const save = async () => {
    if (!valid || durationSec === null) return
    setSaving(true)
    const result = await guard(async () => {
      const saved = await workoutService.logExternal({
        sessionId: session?.id,
        userId: user.id,
        date: session?.date ?? todayKey(),
        source,
        sourceName,
        planName,
        dayNumber: Number(dayNumber) || undefined,
        name: name.trim() || planName.trim(),
        exerciseCount: Number(exerciseCount) || 0,
        durationSec,
        caloriesKcal: Number(calories) || 0,
        difficulty,
        note,
      })
      await achievementService.evaluate(user.id)
      await challengeService.announceIfComplete(saved.date, user.id)
      return saved
    })
    setSaving(false)

    if (result !== undefined) {
      // The screenshot never outlives the form. Nothing is written anywhere.
      temp.release()
      show(session ? 'Workout updated.' : 'Workout logged. Nice one.', 'success')
      onDone()
    }
  }

  return (
    <>
      <fieldset className={styles.apps}>
        <legend className={styles.legend}>Which app?</legend>
        <div className={styles.appRow}>
          {WORKOUT_APPS.map((app) => {
            const on = source === app.value
            return (
              <button
                key={app.value}
                className={[styles.app, on ? styles.appOn : ''].filter(Boolean).join(' ')}
                aria-pressed={on}
                onClick={() => setSource(app.value)}
              >
                {app.short}
              </button>
            )
          })}
        </div>
      </fieldset>

      {source === 'other' ? (
        <Field
          label="App name"
          value={sourceName}
          placeholder="Which app was it?"
          onChange={(event) => setSourceName(event.target.value)}
        />
      ) : null}

      <Field
        label="Plan"
        value={planName}
        placeholder="Full Body Beginner"
        onChange={(event) => setPlanName(event.target.value)}
      />

      <div className={styles.pair}>
        <Field
          label="Day"
          type="number"
          inputMode="numeric"
          value={dayNumber}
          placeholder="13"
          onChange={(event) => setDayNumber(event.target.value)}
        />
        <Field
          label="Exercises"
          type="number"
          inputMode="numeric"
          value={exerciseCount}
          placeholder="8"
          onChange={(event) => setExerciseCount(event.target.value)}
        />
      </div>

      <Field
        label="Workout name"
        value={name}
        placeholder={planName.trim() || 'Full Body Beginner'}
        onChange={(event) => setName(event.target.value)}
      />

      <div className={styles.pair}>
        <Field
          label="Duration"
          value={durationText}
          inputMode="numeric"
          placeholder="06:23"
          hint={durationBad ? 'Try mm:ss, like 06:23.' : undefined}
          onChange={(event) => setDurationText(event.target.value)}
        />
        <Field
          label="Calories"
          type="number"
          inputMode="decimal"
          suffix="kcal"
          value={calories}
          placeholder="126"
          onChange={(event) => setCalories(event.target.value)}
        />
      </div>

      <OptionGroup
        label="How did it feel?"
        value={difficulty}
        options={DIFFICULTY_OPTIONS}
        onChange={setDifficulty}
      />

      <Field
        label="Note"
        value={note}
        placeholder="Optional"
        maxLength={140}
        onChange={(event) => setNote(event.target.value)}
      />

      {/* --- Optional screenshot, held in memory only --- */}
      <div className={styles.attach}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={attach}
          aria-label="Attach the workout result screenshot"
        />
        {temp.url ? (
          <div className={styles.preview}>
            <img src={temp.url} alt="The workout summary you attached" />
            <button
              className={styles.removeShot}
              onClick={temp.release}
              aria-label="Remove screenshot"
            >
              <X size={15} strokeWidth={2.4} />
            </button>
          </div>
        ) : (
          <Button
            variant="secondary"
            icon={<ImagePlus size={16} strokeWidth={2} />}
            onClick={() => fileInput.current?.click()}
          >
            Attach result screenshot
          </Button>
        )}
        <p className={styles.attachNote}>
          Optional, and only shown while you fill this in — the picture is never saved.
        </p>
      </div>

      <Button size="lg" block onClick={save} disabled={saving || !valid}>
        {saving ? 'Saving…' : session ? 'Save changes' : 'Save workout'}
      </Button>
    </>
  )
}
