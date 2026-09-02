import { useEffect, useState } from 'react'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import { ImageUp, Info, PencilLine, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, challengeService, workoutService } from '@/services'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import { WORKOUT_APPS } from '@/data/workoutApps'
import { ManualWorkoutForm } from './ManualWorkoutForm'
import { WorkoutImportFlow } from './WorkoutImportFlow'
import type { Difficulty, WorkoutSession, WorkoutSource } from '@/models'
import { todayKey } from '@/utils/date'
import { duration, parseDuration } from '@/utils/format'
import styles from './LogWorkoutForm.module.css'

type Stage = 'choose' | 'form' | 'manual' | 'import'

/**
 * Logging a workout done somewhere else.
 *
 * The workouts happen in Home Workout, Lose Weight for Men and the rest. This
 * app is the tracker, and the other app has already counted everything and
 * printed it on a summary screen — so the fastest honest way to record a
 * session is to photograph that screen and correct whatever did not come
 * through, rather than to retype six fields that are already on the phone.
 *
 * There are two ways in and this screen is only the fork between them.
 * Reading a screenshot belongs to `WorkoutImportFlow`, writing one down
 * belongs to `ManualWorkoutForm`, and both end in the same editor and the same
 * save. This file used to carry a second, unreachable copy of the screenshot
 * reader that filled its own summary fields through its own save path; it is
 * gone. One import route, one editor per record.
 *
 * The summary form below is not that second route. It is how an *existing*
 * external log is edited — a record with a workout's totals and no exercise
 * list, which is the shape those sessions actually have.
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

  /*
   * Editing an existing log has nothing to scan, so it opens on a form — and
   * on the one that wrote it. A hand-written session goes back to the manual
   * form, where its exercises are; anything imported goes to the summary form,
   * which is the shape that record actually has.
   */
  const [stage, setStage] = useState<Stage>(
    session ? (session.loggedVia === 'manual' ? 'manual' : 'form') : 'choose',
  )
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
   * day number moved on. Runs once so it never overwrites typing — and it runs
   * whichever route the user takes, so the manual form is never blank and a
   * scan only has to fill in what it actually read.
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
      show(session ? 'Workout updated.' : 'Workout logged. Nice one.', 'success')
      onDone()
    }
  }

  /*
   * One history entry per sub-screen.
   *
   * The sheet itself already owns an entry (see `Sheet`), so Back unwinds
   * inside out: from the form or the failure screen it lands back on the
   * choice, and from the choice it closes the whole sheet. Before this, Back
   * left the flow entirely while the sheet stayed on screen.
   *
   * Mounted only on the sub-screens, which is what makes the entry appear and
   * disappear with them — `useHistoryDismiss` pushes on mount and pops on
   * unmount, so the stack is always exactly as deep as the flow is.
   */
  const subScreen = stage !== 'choose' && !session

  // --- Choose --------------------------------------------------------------
  if (stage === 'choose') {
    return (
      <>
        {/*
          Two ways in, and writing it down is the first of them.

          The screenshot route reads another app's summary screen, which is the
          fastest thing in the world when you have one and no use at all when
          you do not — a run outside, a football match, a session in a gym with
          no app behind it. Typing was the secondary action here and it is the
          one most sessions actually need, so it leads now. Neither is removed.
        */}
        <Button
          size="lg"
          block
          icon={<PencilLine size={17} strokeWidth={2.2} />}
          onClick={() => setStage('manual')}
        >
          Log it myself
        </Button>

        <Button
          variant="secondary"
          size="lg"
          block
          icon={<ImageUp size={16} strokeWidth={2.2} />}
          onClick={() => setStage('import')}
        >
          Add from a screenshot
        </Button>

        <div className={styles.intro}>
          <span className={styles.introIcon} aria-hidden="true">
            <ScanLine size={22} strokeWidth={1.9} />
          </span>
          <p className={styles.introText}>
            Trained in another app? A screenshot of its summary fills in what we can read.
          </p>
        </div>

        <ul className={styles.apps2}>
          {WORKOUT_APPS.filter((app) => app.value !== 'other').map((app) => (
            <li key={app.value}>{app.label}</li>
          ))}
          <li>and others</li>
        </ul>

        <p className={styles.privacy}>
          <Info size={13} strokeWidth={2.2} />
          Your screenshot is sent for reading and then discarded. It is never saved — only the
          workout details you confirm are kept.
        </p>
      </>
    )
  }

  // --- Reading a screenshot --------------------------------------------------
  if (stage === 'import') {
    return (
      <>
        {subScreen ? <StageBack onBack={() => setStage('choose')} /> : null}
        <WorkoutImportFlow onDone={onDone} onCancel={() => setStage('choose')} />
      </>
    )
  }

  // --- Writing it down -------------------------------------------------------
  if (stage === 'manual') {
    return (
      <>
        {subScreen ? <StageBack onBack={() => setStage('choose')} /> : null}
        <ManualWorkoutForm session={session} onDone={onDone} />
      </>
    )
  }

  // --- The summary form ------------------------------------------------------
  return (
    <>
      {subScreen ? <StageBack onBack={() => setStage('choose')} /> : null}

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

      <Button size="lg" block onClick={save} disabled={saving || !valid}>
        {saving ? 'Saving…' : session ? 'Save changes' : 'Save workout'}
      </Button>
    </>
  )
}

/**
 * One history entry, for as long as a sub-screen is on screen.
 *
 * It renders nothing. Its whole job is to exist while the flow is deeper than
 * its first step, so the phone's Back gesture pops *this* rather than the
 * sheet — and once it is gone, the next Back closes the sheet, which is what
 * "back out of the flow itself" should do.
 */
function StageBack({ onBack }: { onBack: () => void }) {
  useHistoryDismiss(onBack)
  return null
}
