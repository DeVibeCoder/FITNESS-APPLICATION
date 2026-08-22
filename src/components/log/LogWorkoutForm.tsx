import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ImageUp, Info, PencilLine, RefreshCw, ScanLine, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { achievementService, challengeService, workoutService } from '@/services'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import {
  scanCoverage,
  workoutScanService,
  WorkoutScanError,
  type WorkoutScan,
} from '@/services/workoutScanService'
import { WORKOUT_APPS } from '@/data/workoutApps'
import type { Difficulty, WorkoutSession, WorkoutSource } from '@/models'
import { todayKey } from '@/utils/date'
import { duration, parseDuration } from '@/utils/format'
import styles from './LogWorkoutForm.module.css'

type Stage = 'choose' | 'analyzing' | 'failed' | 'form'

/** Field names as the server reports them, and what to call them out loud. */
const FIELD_LABEL: Record<string, string> = {
  planName: 'Plan',
  dayNumber: 'Day',
  workoutName: 'Workout name',
  durationSec: 'Duration',
  caloriesKcal: 'Calories',
  exerciseCount: 'Exercises',
}

/**
 * Logging a workout done somewhere else.
 *
 * The workouts happen in Home Workout, Lose Weight for Men and the rest. This
 * app is the tracker, and the other app has already counted everything and
 * printed it on a summary screen — so the fastest honest way to record a
 * session is to photograph that screen and correct whatever did not come
 * through, rather than to retype six fields that are already on the phone.
 *
 * The screenshot route is therefore the primary action and typing is the
 * secondary one. Neither is removed: the manual form is one tap away and is
 * also where every scan lands, because nothing is saved without a person
 * looking at it.
 *
 * The screenshot itself never becomes a record. It is held as an object URL
 * while the review is on screen and released on save, on cancel and on
 * unmount; the saved session carries structured fields only.
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
  const preview = useTempImage()
  const fileInput = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Editing an existing record has nothing to scan, so it opens on the form.
  const [stage, setStage] = useState<Stage>(session ? 'form' : 'choose')
  const [scan, setScan] = useState<WorkoutScan | null>(null)
  const [failure, setFailure] = useState<{ message: string; canRetry: boolean } | null>(null)
  const [slow, setSlow] = useState(false)

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

  // Abandoning the sheet mid-analysis must not leave a request running.
  useEffect(() => () => abortRef.current?.abort(), [])

  // The server may quietly retry a stalled call. The browser cannot observe
  // that, so rather than claim a retry we simply stop pretending it is quick.
  useEffect(() => {
    if (stage !== 'analyzing') {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 6000)
    return () => window.clearTimeout(timer)
  }, [stage])

  if (!user) return null

  const durationSec = parseDuration(durationText)
  const durationBad = durationText.trim().length > 0 && durationSec === null
  const valid = (name.trim() || planName.trim()) && durationSec !== null && durationSec > 0

  /**
   * Copies a reading into the form.
   *
   * Only fields the screenshot actually showed are written. Anything absent
   * keeps whatever the defaults put there, which is why a missing day number
   * still arrives sensibly filled from last time rather than blank.
   */
  const applyScan = (result: WorkoutScan) => {
    if (result.app) setSource(result.app)
    if (result.appName) setSourceName(result.appName)
    if (result.planName) setPlanName(result.planName)
    if (result.dayNumber) setDayNumber(String(result.dayNumber))
    if (result.workoutName) setName(result.workoutName)
    if (result.exerciseCount) setExerciseCount(String(result.exerciseCount))
    if (result.durationSec) setDurationText(duration(result.durationSec))
    if (result.caloriesKcal) setCalories(String(result.caloriesKcal))
    // A screenshot cannot know how it felt, and the note is the user's own.
  }

  const analyze = async (file: File) => {
    // Only one reading in flight: starting a new scan abandons the old one so
    // a second request is never paid for or raced against.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStage('analyzing')
    setFailure(null)
    try {
      const result = await workoutScanService.analyzeScreenshot(file, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setScan(result)
      applyScan(result)
      setStage('form')
    } catch (error) {
      if (controller.signal.aborted) return
      setFailure({
        message:
          error instanceof WorkoutScanError
            ? error.message
            : 'Screenshot reading is temporarily unavailable.',
        canRetry: error instanceof WorkoutScanError ? error.canRetry : true,
      })
      setStage('failed')
    }
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clearing the input means picking the same file again still fires change.
    event.target.value = ''
    if (!file) return // Picker cancelled — nothing to clean up.

    try {
      workoutScanService.validate(file)
    } catch (error) {
      show(
        error instanceof WorkoutScanError ? error.message : "That image couldn't be used.",
        'error',
      )
      return
    }

    preview.set(file)
    void analyze(file)
  }

  const discardScan = () => {
    abortRef.current?.abort()
    abortRef.current = null
    preview.release()
    setScan(null)
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
      preview.release()
      show(session ? 'Workout updated.' : 'Workout logged. Nice one.', 'success')
      onDone()
    }
  }

  const hiddenInput = (
    <input
      ref={fileInput}
      type="file"
      accept={workoutScanService.accept}
      className="sr-only"
      onChange={onPick}
      aria-label="Choose a workout screenshot"
    />
  )

  // --- Choose --------------------------------------------------------------
  if (stage === 'choose') {
    return (
      <>
        <div className={styles.intro}>
          <span className={styles.introIcon} aria-hidden="true">
            <ScanLine size={22} strokeWidth={1.9} />
          </span>
          <p className={styles.introText}>
            Take a screenshot from your workout app and we'll fill in what we can.
          </p>
        </div>

        <Button
          size="lg"
          block
          icon={<ImageUp size={17} strokeWidth={2.2} />}
          onClick={() => fileInput.current?.click()}
        >
          Add workout screenshot
        </Button>

        <Button
          variant="secondary"
          size="lg"
          block
          icon={<PencilLine size={16} strokeWidth={2.2} />}
          onClick={() => setStage('form')}
        >
          Enter manually
        </Button>

        {hiddenInput}

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

  // --- Analysing -----------------------------------------------------------
  if (stage === 'analyzing') {
    return (
      <div className={styles.working}>
        {preview.url ? (
          <img className={styles.workingShot} src={preview.url} alt="" />
        ) : null}
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.workingTitle}>Reading your screenshot…</p>
        <p className={styles.workingHint}>
          {slow ? 'Still going. A slow first request usually settles down.' : 'This takes a moment.'}
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            discardScan()
            setStage('choose')
          }}
        >
          Cancel
        </Button>
      </div>
    )
  }

  // --- Failed --------------------------------------------------------------
  if (stage === 'failed') {
    return (
      <div className={styles.failed}>
        <span className={styles.failedIcon} aria-hidden="true">
          <AlertTriangle size={20} strokeWidth={2} />
        </span>
        <p className={styles.failedTitle}>We couldn't read that one</p>
        <p className={styles.failedBody}>{failure?.message}</p>

        {/*
          Two ways out, and both of them work. Nothing here guesses at the
          workout — an unreadable screenshot means the fields stay empty and
          the user fills them in, which is the manual route they already had.
        */}
        {failure?.canRetry ? (
          <Button
            block
            icon={<RefreshCw size={16} strokeWidth={2.2} />}
            onClick={() => {
              discardScan()
              fileInput.current?.click()
            }}
          >
            Try again
          </Button>
        ) : null}
        <Button
          variant="secondary"
          block
          icon={<PencilLine size={16} strokeWidth={2.2} />}
          onClick={() => {
            discardScan()
            setStage('form')
          }}
        >
          Enter manually
        </Button>
        {hiddenInput}
      </div>
    )
  }

  // --- Review / manual entry -----------------------------------------------
  const coverage = scan ? scanCoverage(scan) : null

  return (
    <>
      {scan ? (
        <div className={styles.scanBanner}>
          {preview.url ? (
            <img className={styles.scanShot} src={preview.url} alt="The screenshot you added" />
          ) : null}
          <div className={styles.scanText}>
            <p className={styles.scanTitle}>
              Read {coverage!.read} of {coverage!.total} fields
            </p>
            <p className={styles.scanHint}>
              {scan.missing.length > 0
                ? `Not visible: ${scan.missing
                    .map((field) => FIELD_LABEL[field] ?? field)
                    .join(', ')}. Fill those in below.`
                : 'Check the values below, then save.'}
            </p>
            {scan.source === 'mock' ? (
              <p className={styles.scanMock}>Development mock — this is not your screenshot.</p>
            ) : null}
          </div>
          <button className={styles.scanDrop} onClick={discardScan} aria-label="Remove screenshot">
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>
      ) : session ? null : (
        <button className={styles.scanOffer} onClick={() => fileInput.current?.click()}>
          <ImageUp size={15} strokeWidth={2.2} />
          Add a workout screenshot instead
        </button>
      )}

      {hiddenInput}

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
