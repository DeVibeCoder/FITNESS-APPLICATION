import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Dumbbell, HeartPulse, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, challengeService, workoutService } from '@/services'
import { DIFFICULTY_OPTIONS } from '@/services/workoutService'
import type {
  Difficulty,
  ExerciseKind,
  LoggedExercise,
  WorkoutKind,
  WorkoutSession,
} from '@/models'
import { todayKey } from '@/utils/date'
import { duration, parseDuration } from '@/utils/format'
import { summarise } from './exerciseSummary'
import styles from './ManualWorkoutForm.module.css'

/** One exercise as it is being edited, before it has an id. */
export type Draft = Omit<LoggedExercise, 'id' | 'sessionId' | 'order'>

/**
 * A workout somebody else worked out, handed over to be checked.
 *
 * Screenshot import fills this in and lets this form do the rest, which is the
 * point: there is one editor, one review step and one save path, so an
 * imported workout cannot drift from a typed one. Every field is optional
 * because a screenshot may have shown any subset of them, and an absent field
 * has to arrive blank rather than as a zero somebody has to notice and undo.
 */
export interface WorkoutDraft {
  kind?: WorkoutKind
  name?: string
  date?: string
  durationSec?: number
  caloriesKcal?: number
  note?: string
  exercises?: Draft[]
}

const KINDS: { value: WorkoutKind; label: string; icon: typeof Dumbbell; hint: string }[] = [
  { value: 'strength', label: 'Strength', icon: Dumbbell, hint: 'Sets and reps' },
  { value: 'cardio', label: 'Cardio', icon: HeartPulse, hint: 'Time and distance' },
  { value: 'general', label: 'Other', icon: Sparkles, hint: 'Just the session' },
]

/**
 * Which shape of exercise a kind of session starts with.
 *
 * A starting point, not a rule: a strength session can hold a cardio finisher
 * and a run can end with core work, so each exercise carries its own kind and
 * can be switched.
 */
const DEFAULT_EXERCISE_KIND: Record<WorkoutKind, ExerciseKind> = {
  strength: 'strength',
  cardio: 'cardio',
  general: 'strength',
}

const blankExercise = (kind: ExerciseKind): Draft => ({ name: '', kind })

/**
 * Writing down a workout you already did.
 *
 * This is a tracker, so there is no timer, no player and nothing to start —
 * the session is over and this records it. The whole design follows from one
 * rule: never ask for a number that does not apply. A run has a distance and
 * no sets, a lifting session has sets and no distance, and plenty of sessions
 * are neither and only need a name and a length. Choosing the kind up front is
 * what lets the form ask three questions instead of nine.
 *
 * Exercises are optional throughout. "45 minutes of football" is a complete
 * and honest record, and demanding a list of movements to accept it would make
 * the log something people stop using.
 *
 * Nothing is written until the summary has been seen. The review step is not
 * ceremony — it is the only place the whole thing is legible at once, and it
 * is where mistyped numbers get noticed.
 */
export function ManualWorkoutForm({
  session,
  draft,
  onStep,
  onDone,
}: {
  /** Editing an existing hand-written log rather than starting a new one. */
  session?: WorkoutSession
  /**
   * Values to start from — what a screenshot was read as. Never saved without
   * being seen: this only fills the form the person is about to check.
   */
  draft?: WorkoutDraft
  /**
   * Which step the form is on. Screenshot import listens so it can put the
   * picture away for the final summary — that step is meant to be the whole
   * workout at a glance, and a screenshot above it is one more thing between
   * the reader and the thing they are confirming.
   */
  onStep?: (step: 'details' | 'review') => void
  onDone: () => void
}) {
  const { user } = useAuth()
  const { show, guard } = useToast()

  const [step, setStep] = useState<'details' | 'review'>('details')
  useEffect(() => onStep?.(step), [step, onStep])
  const [kind, setKind] = useState<WorkoutKind>(session?.kind ?? draft?.kind ?? 'strength')
  const [name, setName] = useState(session?.name ?? draft?.name ?? '')
  const [date, setDate] = useState(session?.date ?? draft?.date ?? todayKey())
  const [durationText, setDurationText] = useState(
    session
      ? duration(session.durationSec)
      : draft?.durationSec
        ? duration(draft.durationSec)
        : '',
  )
  const [calories, setCalories] = useState(
    session?.caloriesKcal ? String(session.caloriesKcal) : draft?.caloriesKcal ? String(draft.caloriesKcal) : '',
  )
  const [difficulty, setDifficulty] = useState<Difficulty>(session?.difficulty ?? 'just_right')
  const [note, setNote] = useState(session?.note ?? draft?.note ?? '')
  const [exercises, setExercises] = useState<Draft[]>(session ? [] : (draft?.exercises ?? []))
  const [editingAt, setEditingAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(!session)

  /** Editing loads the exercises that were written down. Runs once. */
  useEffect(() => {
    if (!session || loaded) return
    let cancelled = false
    void workoutService.exercisesFor(session.id).then((rows) => {
      if (cancelled) return
      setExercises(rows.map(({ id: _id, sessionId: _s, order: _o, ...rest }) => rest))
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [session, loaded])

  if (!user) return null

  const durationSec = parseDuration(durationText) ?? 0
  const named = exercises.filter((exercise) => exercise.name.trim().length > 0)
  // A session needs a length or something in it. Both blank is not a record.
  const valid = durationSec > 0 || named.length > 0

  const addExercise = () => {
    setExercises((current) => [...current, blankExercise(DEFAULT_EXERCISE_KIND[kind])])
    setEditingAt(exercises.length)
  }

  const patch = (index: number, changes: Partial<Draft>) =>
    setExercises((current) =>
      current.map((exercise, at) => (at === index ? { ...exercise, ...changes } : exercise)),
    )

  const removeAt = (index: number) => {
    setExercises((current) => current.filter((_, at) => at !== index))
    setEditingAt(null)
  }

  /** Reordering is a swap, which is all a list of three or four ever needs. */
  const move = (index: number, by: -1 | 1) =>
    setExercises((current) => {
      const to = index + by
      if (to < 0 || to >= current.length) return current
      const next = [...current]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const saved = await guard(async () => {
      const record = await workoutService.logManual({
        sessionId: session?.id,
        userId: user.id,
        date,
        kind,
        name,
        durationSec,
        caloriesKcal: Number.parseFloat(calories) || 0,
        difficulty,
        note,
        exercises: named,
      })
      // The same two follow-ups an imported log triggers, so a hand-written
      // session counts toward awards and the week's challenge identically.
      await achievementService.evaluate(user.id)
      await challengeService.announceIfComplete(date, user.id)
      return record
    })
    setSaving(false)
    if (!saved) return
    show(session ? 'Workout updated.' : 'Workout logged.', 'success')
    onDone()
  }

  // --- Review ---------------------------------------------------------------
  if (step === 'review') {
    return (
      <>
        <div className={styles.review}>
          <p className="eyebrow">{date === todayKey() ? "Today's workout" : date}</p>
          <p className={styles.reviewName}>{name.trim() || KINDS.find((k) => k.value === kind)!.label}</p>
          <p className={styles.reviewMeta}>
            {KINDS.find((k) => k.value === kind)!.label}
            {durationSec > 0 ? ` · ${duration(durationSec)}` : ''}
            {Number.parseFloat(calories) > 0 ? ` · ${Number.parseFloat(calories)} kcal` : ''}
          </p>

          {named.length > 0 ? (
            <>
              <p className={`eyebrow ${styles.reviewHeading}`}>Exercises</p>
              <ul className={styles.reviewList}>
                {named.map((exercise, at) => (
                  <li key={at} className={styles.reviewRow}>
                    <span className={styles.reviewExercise}>{exercise.name}</span>
                    <span className={styles.reviewDetail}>{summarise(exercise)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.reviewEmpty}>No exercises listed — just the session.</p>
          )}

          {note.trim() ? <p className={styles.reviewNote}>“{note.trim()}”</p> : null}
        </div>

        <Button size="lg" block onClick={save} disabled={saving}>
          {saving ? 'Saving…' : session ? 'Save changes' : 'Save workout'}
        </Button>
        <Button variant="ghost" onClick={() => setStep('details')} disabled={saving}>
          Back to editing
        </Button>
      </>
    )
  }

  // --- Details --------------------------------------------------------------
  return (
    <>
      {/*
        The kind first, because it decides what the rest of the form asks for.
        Three tiles rather than a dropdown: there are only three, and a person
        logging a run should not have to open a menu to say so.
      */}
      <fieldset className={styles.kinds}>
        <legend className={styles.label}>What kind of session?</legend>
        <div className={styles.kindRow}>
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              className={[styles.kind, kind === option.value ? styles.kindOn : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setKind(option.value)}
            >
              <option.icon size={17} strokeWidth={2.1} />
              <span className={styles.kindLabel}>{option.label}</span>
              <span className={styles.kindHint}>{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.pair}>
        <Field
          label="Workout"
          value={name}
          placeholder={KINDS.find((k) => k.value === kind)!.label}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          label="Date"
          type="date"
          value={date}
          max={todayKey()}
          onChange={(event) => setDate(event.target.value || todayKey())}
        />
      </div>

      <div className={styles.pair}>
        <Field
          label="How long"
          value={durationText}
          inputMode="numeric"
          placeholder="45:00"
          hint="Minutes, or mm:ss."
          onChange={(event) => setDurationText(event.target.value)}
        />
        {/*
          Optional, and blank by default. A hand-written log has no honest
          calorie figure to offer; an imported one has whatever the other app
          printed, and nothing when it printed nothing.
        */}
        <Field
          label="Calories"
          type="number"
          inputMode="numeric"
          min={0}
          suffix="kcal"
          value={calories}
          placeholder="—"
          onChange={(event) => setCalories(event.target.value)}
        />
      </div>

      {/* --- Exercises -------------------------------------------------- */}
      <section className={styles.exercises}>
        <div className={styles.exercisesHead}>
          <p className={styles.label}>Exercises</p>
          <span className={styles.optional}>Optional</span>
        </div>

        {exercises.length === 0 ? (
          <p className={styles.exercisesEmpty}>
            Add what you did, or leave this out and record just the session.
          </p>
        ) : (
          <ul className={styles.exerciseList}>
            {exercises.map((exercise, at) => (
              <li key={at} className={styles.exerciseItem}>
                {editingAt === at ? (
                  <ExerciseEditor
                    exercise={exercise}
                    onChange={(changes) => patch(at, changes)}
                    onDone={() => setEditingAt(null)}
                    onRemove={() => removeAt(at)}
                  />
                ) : (
                  <div className={styles.exerciseRow}>
                    <span className={styles.exerciseText}>
                      <span className={styles.exerciseName}>
                        {exercise.name.trim() || 'Untitled exercise'}
                      </span>
                      <span className={styles.exerciseDetail}>{summarise(exercise)}</span>
                    </span>
                    <span className={styles.exerciseTools}>
                      <button
                        className={styles.tool}
                        onClick={() => move(at, -1)}
                        disabled={at === 0}
                        aria-label={`Move ${exercise.name || 'this exercise'} up`}
                      >
                        <ChevronUp size={15} strokeWidth={2.4} />
                      </button>
                      <button
                        className={styles.tool}
                        onClick={() => move(at, 1)}
                        disabled={at === exercises.length - 1}
                        aria-label={`Move ${exercise.name || 'this exercise'} down`}
                      >
                        <ChevronDown size={15} strokeWidth={2.4} />
                      </button>
                      <button
                        className={styles.tool}
                        onClick={() => setEditingAt(at)}
                        aria-label={`Edit ${exercise.name || 'this exercise'}`}
                      >
                        <Pencil size={14} strokeWidth={2.2} />
                      </button>
                      <button
                        className={`${styles.tool} ${styles.toolDanger}`}
                        onClick={() => removeAt(at)}
                        aria-label={`Remove ${exercise.name || 'this exercise'}`}
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <button className={styles.addExercise} onClick={addExercise}>
          <Plus size={16} strokeWidth={2.6} />
          Add exercise
        </button>
      </section>

      <OptionGroup
        label="How did it feel?"
        value={difficulty}
        options={DIFFICULTY_OPTIONS}
        onChange={setDifficulty}
      />

      <Field
        label="Notes"
        value={note}
        placeholder="Optional"
        maxLength={280}
        onChange={(event) => setNote(event.target.value)}
      />

      <Button size="lg" block onClick={() => setStep('review')} disabled={!valid}>
        Review
      </Button>
      {!valid ? (
        <p className={styles.needs}>Add a length or at least one exercise.</p>
      ) : null}
    </>
  )
}

/**
 * One exercise, open for editing.
 *
 * The fields follow the exercise's own kind rather than the session's, so a
 * cardio finisher inside a lifting session asks for minutes and not for reps.
 */
function ExerciseEditor({
  exercise,
  onChange,
  onDone,
  onRemove,
}: {
  exercise: Draft
  onChange: (changes: Partial<Draft>) => void
  onDone: () => void
  onRemove: () => void
}) {
  const numeric = (value: string): number | undefined => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  return (
    <div className={styles.editor}>
      <Field
        label="Exercise"
        value={exercise.name}
        autoFocus
        placeholder={exercise.kind === 'cardio' ? 'Treadmill run' : 'Back squat'}
        onChange={(event) => onChange({ name: event.target.value })}
      />

      <OptionGroup
        label="Type"
        value={exercise.kind}
        options={[
          { value: 'strength', label: 'Sets & reps' },
          { value: 'cardio', label: 'Time & distance' },
        ]}
        onChange={(next) =>
          // Switching clears the other shape's numbers rather than carrying
          // them along invisibly to be saved on a row they do not belong to.
          onChange(
            next === 'cardio'
              ? { kind: next, sets: undefined, reps: undefined, weightKg: undefined }
              : { kind: next, durationSec: undefined, distanceKm: undefined },
          )
        }
      />

      {exercise.kind === 'strength' ? (
        <div className={styles.triple}>
          <Field
            label="Sets"
            type="number"
            inputMode="numeric"
            min={0}
            value={exercise.sets ?? ''}
            placeholder="3"
            onChange={(event) => onChange({ sets: numeric(event.target.value) })}
          />
          <Field
            label="Reps"
            type="number"
            inputMode="numeric"
            min={0}
            value={exercise.reps ?? ''}
            placeholder="12"
            onChange={(event) => onChange({ reps: numeric(event.target.value) })}
          />
          <Field
            label="Weight"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="kg"
            value={exercise.weightKg ?? ''}
            placeholder="—"
            onChange={(event) => onChange({ weightKg: numeric(event.target.value) })}
          />
        </div>
      ) : (
        <div className={styles.pair}>
          <Field
            label="Time"
            inputMode="numeric"
            value={exercise.durationSec ? duration(exercise.durationSec) : ''}
            placeholder="20:00"
            onChange={(event) =>
              onChange({ durationSec: parseDuration(event.target.value) ?? undefined })
            }
          />
          <Field
            label="Distance"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="km"
            value={exercise.distanceKm ?? ''}
            placeholder="—"
            onChange={(event) => onChange({ distanceKm: numeric(event.target.value) })}
          />
        </div>
      )}

      <div className={styles.editorActions}>
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
        <Button variant="ghost" icon={<Trash2 size={15} strokeWidth={2.1} />} onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  )
}

