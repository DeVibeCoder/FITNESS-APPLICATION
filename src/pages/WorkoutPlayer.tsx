import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronLeft, Minus, Pause, Play, Plus, RotateCcw, SkipForward, X } from 'lucide-react'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { WorkoutComplete } from '@/components/workout/WorkoutComplete'
import { ExerciseFigure } from '@/components/workout/ExerciseFigure'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTicker } from '@/hooks/useTicker'
import { achievementService, progressService, workoutService } from '@/services'
import type { ResolvedExercise } from '@/services/workoutService'
import type { Difficulty } from '@/models'
import { estimateWorkoutCalories } from '@/utils/calories'
import { todayKey } from '@/utils/date'
import { duration, num } from '@/utils/format'
import styles from './WorkoutPlayer.module.css'

type Screen = 'prep' | 'exercise' | 'rest' | 'paused' | 'done' | 'finished'

/**
 * Full-screen workout mode. Deliberately outside the app shell: no bottom bar,
 * no dashboard, one large action at a time. Runs dark in both themes so it
 * reads at arm's length and is unmistakably a different mode.
 */
export function WorkoutPlayer() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { show, guard } = useToast()

  const session = useLiveQuery(
    () => (user ? workoutService.activeSession(user.id) : undefined),
    [user?.id],
  )
  const day = useLiveQuery(
    () => (user ? workoutService.scheduledFor(user.id, todayKey()) : undefined),
    [user?.id],
  )
  const results = useLiveQuery(
    async () => (session ? workoutService.setResults(session.id) : []),
    [session?.id],
  )
  const bodyWeightKg = useLiveQuery(
    () => (user ? progressService.currentWeight(user.id) : undefined),
    [user?.id],
  )

  // Rest and per-exercise countdowns are held as end timestamps, never as
  // counters, so a throttled tab cannot make them drift.
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  const [holdEndsAt, setHoldEndsAt] = useState<number | null>(null)
  const [frozen, setFrozen] = useState<{ rest: number | null; hold: number | null } | null>(null)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  /**
   * Captured when the user chooses to finish. Holding a snapshot freezes the
   * numbers on the completion screen and keeps it rendered through the frame
   * where the live session has already stopped being "in progress".
   */
  const [finishing, setFinishing] = useState<{
    dayNumber?: number
    name: string
    exerciseCount: number
    caloriesKcal: number
    durationSec: number
    skipped: number
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)

  const paused = Boolean(session?.pausedAt)
  const now = useTicker(Boolean(session) && !paused && finishing === null)

  const exercises = useMemo(() => day?.exercises ?? [], [day])
  const cursor = useMemo(
    () => workoutService.cursor(exercises, results ?? []),
    [exercises, results],
  )
  const current: ResolvedExercise | undefined = exercises[cursor.exerciseIndex]
  const next = exercises[cursor.exerciseIndex + 1]

  const restLeft = restEndsAt === null ? 0 : Math.max(0, Math.ceil((restEndsAt - now) / 1000))
  const holdLeft = holdEndsAt === null ? 0 : Math.max(0, Math.ceil((holdEndsAt - now) / 1000))
  const elapsed = session ? workoutService.elapsedSec(session, now) : 0

  const met = useMemo(() => workoutService.averageMet(exercises), [exercises])
  const weightForEstimate = bodyWeightKg ?? user?.startWeightKg ?? 75
  const estimatedKcal = estimateWorkoutCalories(met, weightForEstimate, elapsed)

  const logCurrentSet = useCallback(
    async (loggedDurationSec?: number) => {
      if (!session || !current) return
      await guard(() =>
        workoutService.logSet({
          sessionId: session.id,
          workoutExerciseId: current.id,
          setIndex: cursor.setIndex,
          reps: current.reps,
          durationSec: loggedDurationSec ?? current.durationSec,
          weightKg: weightKg ?? current.weightKg,
        }),
      )
      setHoldEndsAt(null)
      // No rest after the very last set — go straight to the finish screen.
      const lastSetOfLastExercise =
        cursor.exerciseIndex === exercises.length - 1 && cursor.setIndex === current.sets - 1
      if (!lastSetOfLastExercise && current.restSec > 0) {
        setRestEndsAt(Date.now() + current.restSec * 1000)
      }
    },
    [session, current, cursor, exercises.length, weightKg, guard],
  )

  // Countdowns clear themselves the moment they reach zero.
  useEffect(() => {
    if (restEndsAt !== null && restLeft === 0) setRestEndsAt(null)
  }, [restEndsAt, restLeft])

  useEffect(() => {
    if (holdEndsAt !== null && holdLeft === 0) {
      const held = current?.durationSec
      setHoldEndsAt(null)
      void logCurrentSet(held)
    }
  }, [holdEndsAt, holdLeft, current?.durationSec, logCurrentSet])

  // A new exercise starts with a clean weight entry.
  useEffect(() => {
    setWeightKg(null)
    setConfirmSkip(false)
  }, [cursor.exerciseIndex])

  if (!user || day === undefined || session === undefined) return <LoadingScreen />

  // --- No workout to run ---------------------------------------------------
  if (!day || day.isRestDay || exercises.length === 0) {
    return (
      <div className={styles.screen}>
        <div className={styles.centred}>
          <p className={styles.emptyTitle}>Nothing to run today</p>
          <p className={styles.emptyBody}>
            {day?.isRestDay
              ? 'Today is a scheduled rest day. Your next session is tomorrow.'
              : 'There is no workout scheduled. Pick a plan and today’s session appears here.'}
          </p>
          <button className={styles.primary} onClick={() => navigate('/workout')}>
            Back to workout
          </button>
        </div>
      </div>
    )
  }

  const beginFinish = () =>
    setFinishing({
      dayNumber: session?.dayNumber,
      name: session?.name ?? day.planDay.name,
      exerciseCount: exercises.length,
      caloriesKcal: estimatedKcal,
      durationSec: elapsed,
      skipped: countSkippedExercises(exercises, results ?? []),
    })

  const screen: Screen = finishing
    ? 'finished'
    : !session
      ? 'prep'
      : paused
        ? 'paused'
        : cursor.finished
          ? 'done'
          : restEndsAt !== null
            ? 'rest'
            : 'exercise'

  // --- Actions -------------------------------------------------------------

  const start = async () => {
    setStarting(true)
    const created = await guard(
      () =>
        workoutService.start({
          userId: user.id,
          planId: day.plan.id,
          planDayId: day.planDay.id,
          dayNumber: day.dayNumber,
          name: day.planDay.name,
          exerciseCount: exercises.length,
        }),
      "Couldn't start the session. Try again.",
    )
    setStarting(false)
    if (created === undefined) navigate('/workout')
  }

  const pause = () => session && guard(() => workoutService.pause(session.id))

  const resume = async () => {
    if (!session) return
    await guard(() => workoutService.resume(session.id))
    // Countdowns pick up exactly where they were frozen.
    if (frozen) {
      const at = Date.now()
      setRestEndsAt(frozen.rest === null ? null : at + frozen.rest)
      setHoldEndsAt(frozen.hold === null ? null : at + frozen.hold)
      setFrozen(null)
    }
  }

  const onPause = () => {
    setFrozen({
      rest: restEndsAt === null ? null : Math.max(0, restEndsAt - Date.now()),
      hold: holdEndsAt === null ? null : Math.max(0, holdEndsAt - Date.now()),
    })
    setRestEndsAt(null)
    setHoldEndsAt(null)
    void pause()
  }

  const skipExercise = async () => {
    if (!session || !current) return
    await guard(() =>
      workoutService.skipExercise({
        sessionId: session.id,
        workoutExerciseId: current.id,
        sets: current.sets,
      }),
    )
    setConfirmSkip(false)
    setRestEndsAt(null)
    setHoldEndsAt(null)
  }

  const undo = async () => {
    if (!session) return
    await guard(() => workoutService.undoLastSet(session.id))
    setRestEndsAt(null)
  }

  const endWorkout = async () => {
    if (!session) return
    await guard(() => workoutService.abandon(session.id))
    show('Workout ended. Nothing was counted.')
    navigate('/workout')
  }

  const finish = async (difficulty?: Difficulty, note?: string) => {
    if (!session || saving || !finishing) return
    setSaving(true)
    const done = await guard(async () => {
      await workoutService.complete({
        sessionId: session.id,
        durationSec: Math.max(1, finishing.durationSec),
        difficulty,
        note,
        met,
        bodyWeightKg: weightForEstimate,
      })
      await achievementService.evaluate(user.id)
    })
    setSaving(false)
    if (done !== undefined) {
      show('Session saved. Chain intact.', 'success')
      navigate('/workout', { replace: true })
    }
  }

  // --- Screens -------------------------------------------------------------

  if (screen === 'prep') {
    return (
      <div className={styles.screen}>
        <button className={styles.close} onClick={() => navigate('/workout')} aria-label="Back">
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
        <div className={styles.centred}>
          <p className={styles.prepDay}>Day {day.dayNumber}</p>
          <h1 className={styles.prepName}>{day.planDay.name}</h1>
          <p className={styles.prepPlan}>{day.plan.name}</p>
          <dl className={styles.prepStats}>
            <div>
              <dd className="tnum">{exercises.length}</dd>
              <dt>Exercises</dt>
            </div>
            <div>
              <dd className="tnum">~{day.estimatedMinutes}</dd>
              <dt>Minutes</dt>
            </div>
            <div>
              <dd className={styles.prepLevel}>{day.plan.level}</dd>
              <dt>Level</dt>
            </div>
          </dl>
          <button className={styles.primary} onClick={start} disabled={starting}>
            <Play size={18} strokeWidth={2.6} fill="currentColor" />
            {starting ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    )
  }

  if (finishing) {
    return (
      <WorkoutComplete
        dayNumber={finishing.dayNumber}
        name={finishing.name}
        exerciseCount={finishing.exerciseCount}
        caloriesKcal={finishing.caloriesKcal}
        durationSec={finishing.durationSec}
        skipped={finishing.skipped}
        saving={saving}
        onFinish={finish}
      />
    )
  }

  return (
    <div className={styles.screen}>
      <header className={styles.bar}>
        <button className={styles.iconButton} onClick={() => navigate('/workout')} aria-label="Leave workout">
          <X size={19} strokeWidth={2.2} />
        </button>
        <div className={styles.barText}>
          <p className={styles.barTitle}>
            Day {session?.dayNumber} · {session?.name}
          </p>
          <p className={`${styles.barTime} tnum`}>{duration(elapsed)}</p>
        </div>
        <button
          className={styles.iconButton}
          onClick={paused ? resume : onPause}
          aria-label={paused ? 'Resume workout' : 'Pause workout'}
        >
          {paused ? <Play size={18} strokeWidth={2.4} /> : <Pause size={18} strokeWidth={2.4} />}
        </button>
      </header>

      <div className={styles.progress} aria-hidden="true">
        <div
          className={styles.progressFill}
          style={{ width: `${cursor.totalSets ? (cursor.setsDone / cursor.totalSets) * 100 : 0}%` }}
        />
      </div>
      <p className={styles.progressLabel}>
        <span className="tnum">{cursor.exercisesDone}</span> of{' '}
        <span className="tnum">{exercises.length}</span> exercises ·{' '}
        <span className="tnum">{cursor.setsDone}</span>/<span className="tnum">{cursor.totalSets}</span> sets
      </p>

      {screen === 'paused' ? (
        <div className={styles.centred}>
          <p className={styles.pausedLabel}>Workout paused</p>
          <p className={`${styles.pausedTime} tnum`}>{duration(elapsed)}</p>
          <button className={styles.primary} onClick={resume}>
            <Play size={18} strokeWidth={2.6} fill="currentColor" />
            Resume
          </button>
          {confirmEnd ? (
            <div className={styles.confirm}>
              <p className={styles.confirmText}>
                End without finishing? It will be saved as an unfinished session and will not count
                toward your week.
              </p>
              <div className={styles.confirmRow}>
                <button className={styles.ghost} onClick={() => setConfirmEnd(false)}>
                  Cancel
                </button>
                <button className={styles.danger} onClick={endWorkout}>
                  End workout
                </button>
              </div>
            </div>
          ) : (
            <button className={styles.ghost} onClick={() => setConfirmEnd(true)}>
              End workout
            </button>
          )}
        </div>
      ) : null}

      {screen === 'rest' && current ? (
        <div className={styles.centred}>
          <p className={styles.restLabel}>Rest</p>
          <p className={`${styles.restTime} tnum`}>{duration(restLeft)}</p>
          {/* The cursor already points at whatever comes next, set or exercise. */}
          <p className={styles.restNext}>
            Next: {current.exercise.name} · set{' '}
            <span className="tnum">{cursor.setIndex + 1}</span> of{' '}
            <span className="tnum">{current.sets}</span>
          </p>
          <div className={styles.restActions}>
            <button
              className={styles.secondary}
              onClick={() => setRestEndsAt((at) => (at === null ? null : at + 15000))}
            >
              <Plus size={15} strokeWidth={2.6} />
              15 sec
            </button>
            <button className={styles.primary} onClick={() => setRestEndsAt(null)}>
              Skip rest
            </button>
          </div>
        </div>
      ) : null}

      {screen === 'exercise' && current ? (
        <div className={styles.body}>
          <p className={styles.counter}>
            Exercise <span className="tnum">{cursor.exerciseIndex + 1}</span> of{' '}
            <span className="tnum">{exercises.length}</span>
          </p>
          <h1 className={styles.exerciseName}>{current.exercise.name}</h1>

          <ExerciseFigure exercise={current.exercise} />

          <p className={styles.target}>
            {current.durationSec ? (
              <>
                <span className="tnum">{current.durationSec}</span> sec
              </>
            ) : (
              <>
                <span className="tnum">{current.reps}</span> reps
              </>
            )}
          </p>
          {current.exercise.cue ? <p className={styles.cue}>{current.exercise.cue}</p> : null}

          <ul className={styles.sets}>
            {Array.from({ length: current.sets }, (_, index) => {
              const state =
                index < cursor.setIndex ? 'done' : index === cursor.setIndex ? 'active' : 'todo'
              return (
                <li key={index} className={`${styles.set} ${styles[state]}`}>
                  <span className={styles.setLabel}>Set {index + 1}</span>
                  {state === 'done' ? <Check size={12} strokeWidth={3.2} /> : null}
                </li>
              )
            })}
          </ul>

          {needsWeight(current) ? (
            <div className={styles.weight}>
              <button
                className={styles.weightStep}
                onClick={() => setWeightKg((w) => Math.max(0, (w ?? current.weightKg ?? 0) - 2.5))}
                aria-label="Decrease weight"
              >
                <Minus size={15} strokeWidth={2.6} />
              </button>
              <span className={styles.weightValue}>
                <span className="tnum">{num(weightKg ?? current.weightKg ?? 0, 1)}</span> kg
              </span>
              <button
                className={styles.weightStep}
                onClick={() => setWeightKg((w) => (w ?? current.weightKg ?? 0) + 2.5)}
                aria-label="Increase weight"
              >
                <Plus size={15} strokeWidth={2.6} />
              </button>
            </div>
          ) : null}

          <div className={styles.actions}>
            {current.durationSec && holdEndsAt !== null ? (
              <button
                className={styles.primary}
                onClick={() => {
                  const held = current.durationSec! - holdLeft
                  setHoldEndsAt(null)
                  void logCurrentSet(Math.max(1, held))
                }}
              >
                <span className="tnum">{duration(holdLeft)}</span> · finish early
              </button>
            ) : current.durationSec ? (
              <button
                className={styles.primary}
                onClick={() => setHoldEndsAt(Date.now() + current.durationSec! * 1000)}
              >
                <Play size={17} strokeWidth={2.6} fill="currentColor" />
                Start <span className="tnum">{current.durationSec}</span>s
              </button>
            ) : (
              <button className={styles.primary} onClick={() => logCurrentSet()}>
                Complete set <span className="tnum">{cursor.setIndex + 1}</span> of{' '}
                <span className="tnum">{current.sets}</span>
              </button>
            )}

            {confirmSkip ? (
              <div className={styles.confirmRow}>
                <button className={styles.ghost} onClick={() => setConfirmSkip(false)}>
                  Cancel
                </button>
                <button className={styles.secondary} onClick={skipExercise}>
                  Skip exercise
                </button>
              </div>
            ) : (
              <div className={styles.minorRow}>
                <button
                  className={styles.minor}
                  onClick={undo}
                  disabled={cursor.setsDone === 0}
                >
                  <RotateCcw size={13} strokeWidth={2.2} />
                  Undo set
                </button>
                <button className={styles.minor} onClick={() => setConfirmSkip(true)}>
                  <SkipForward size={13} strokeWidth={2.2} />
                  Skip exercise
                </button>
              </div>
            )}
          </div>

          {next ? <p className={styles.next}>Next up · {next.exercise.name}</p> : null}
        </div>
      ) : null}

      {screen === 'done' ? (
        <div className={styles.centred}>
          <span className={styles.doneMark} aria-hidden="true">
            <Check size={26} strokeWidth={3} />
          </span>
          <p className={styles.doneTitle}>Every set done</p>
          <p className={styles.doneBody}>
            <span className="tnum">{cursor.setsDone}</span> of{' '}
            <span className="tnum">{cursor.totalSets}</span> sets in{' '}
            <span className="tnum">{duration(elapsed)}</span>.
          </p>
          <button className={styles.primary} onClick={() => beginFinish()}>
            Finish workout
          </button>
          <button className={styles.ghost} onClick={undo}>
            <RotateCcw size={14} strokeWidth={2.2} />
            Undo last set
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** An exercise counts as skipped when none of its sets were actually performed. */
function countSkippedExercises(
  exercises: ResolvedExercise[],
  results: { workoutExerciseId: string; completed: boolean; skipped?: boolean }[],
): number {
  return exercises.filter((item) => {
    const rows = results.filter((row) => row.workoutExerciseId === item.id)
    return rows.length > 0 && rows.every((row) => row.skipped) && !rows.some((row) => row.completed)
  }).length
}

/** Only ask for weight where it means something. */
function needsWeight(item: ResolvedExercise): boolean {
  return item.exercise.equipment !== 'bodyweight' || item.weightKg !== undefined
}
