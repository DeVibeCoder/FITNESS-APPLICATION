/**
 * What a workout is allowed to say about itself.
 *
 * The database already refuses cross-kind nonsense — migration 0002 carries a
 * CHECK per kind — but a constraint violation surfaces as a 500 and a SQLite
 * error string, which is no use to anybody holding a phone. This rejects the
 * same things earlier and says which field was wrong.
 *
 * The two are deliberately not one. Validation here is a courtesy to the
 * caller; the constraint is the guarantee, and it holds even if this file is
 * bypassed.
 */

export type WorkoutKind = 'strength' | 'cardio' | 'general'
export type ExerciseKind = 'strength' | 'timed' | 'cardio'

export interface ExerciseInput {
  name: string
  kind: ExerciseKind
  sets?: number | null
  reps?: number | null
  weightKg?: number | null
  durationSec?: number | null
  distanceKm?: number | null
  note?: string | null
}

export interface SetResultInput {
  planExerciseId?: string | null
  setIndex: number
  reps?: number | null
  durationSec?: number | null
  weightKg?: number | null
  completed?: boolean
  skipped?: boolean
}

export interface WorkoutInput {
  date: string
  kind: WorkoutKind
  name: string
  status?: 'active' | 'completed' | 'abandoned'
  durationSec?: number
  caloriesKcal?: number
  difficulty?: 'hard' | 'just_right' | 'easy' | null
  note?: string | null
  loggedVia?: 'player' | 'quick_log' | 'manual'
  exercises?: ExerciseInput[]
  setResults?: SetResultInput[]
}

export class InvalidWorkout extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'InvalidWorkout'
    this.field = field
  }
}

const WORKOUT_KINDS: WorkoutKind[] = ['strength', 'cardio', 'general']
const EXERCISE_KINDS: ExerciseKind[] = ['strength', 'timed', 'cardio']

/** Which fields each kind may carry. Everything else must be absent. */
const ALLOWED: Record<ExerciseKind, (keyof ExerciseInput)[]> = {
  strength: ['sets', 'reps', 'weightKg'],
  timed: ['sets', 'durationSec'],
  cardio: ['durationSec', 'distanceKm'],
}
const MEASURES: (keyof ExerciseInput)[] = ['sets', 'reps', 'weightKg', 'durationSec', 'distanceKm']

const present = (value: unknown): boolean => value !== undefined && value !== null

function positive(value: unknown, field: string): number | null {
  if (!present(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new InvalidWorkout(field, `${field} must be a positive number.`)
  return n
}

export function validateExercise(exercise: ExerciseInput, index: number): ExerciseInput {
  const at = `exercises[${index}]`
  if (typeof exercise?.name !== 'string' || !exercise.name.trim()) {
    throw new InvalidWorkout(`${at}.name`, 'Every exercise needs a name.')
  }
  if (!EXERCISE_KINDS.includes(exercise.kind)) {
    throw new InvalidWorkout(`${at}.kind`, `Unknown exercise kind "${exercise.kind}".`)
  }

  // The rule the database also enforces, said in words a person can act on.
  const allowed = ALLOWED[exercise.kind]
  for (const measure of MEASURES) {
    if (present(exercise[measure]) && !allowed.includes(measure)) {
      throw new InvalidWorkout(
        `${at}.${measure}`,
        `A ${exercise.kind} exercise cannot carry ${measure}.`,
      )
    }
  }

  return {
    name: exercise.name.trim(),
    kind: exercise.kind,
    sets: positive(exercise.sets, `${at}.sets`),
    reps: positive(exercise.reps, `${at}.reps`),
    weightKg: positive(exercise.weightKg, `${at}.weightKg`),
    durationSec: positive(exercise.durationSec, `${at}.durationSec`),
    distanceKm: positive(exercise.distanceKm, `${at}.distanceKm`),
    note: typeof exercise.note === 'string' && exercise.note.trim() ? exercise.note.trim() : null,
  }
}

export function validateWorkout(body: unknown): Required<Pick<WorkoutInput, 'date' | 'kind' | 'name'>> & WorkoutInput {
  const input = body as WorkoutInput
  if (!input || typeof input !== 'object') throw new InvalidWorkout('body', 'No workout was received.')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date))) {
    throw new InvalidWorkout('date', 'A workout needs a date, as YYYY-MM-DD.')
  }
  if (!WORKOUT_KINDS.includes(input.kind)) {
    throw new InvalidWorkout('kind', `Unknown workout kind "${input.kind}".`)
  }

  const exercises = Array.isArray(input.exercises)
    ? input.exercises.map((exercise, index) => validateExercise(exercise, index))
    : []

  const setResults = Array.isArray(input.setResults)
    ? input.setResults.map((result, index) => {
        if (!Number.isInteger(result?.setIndex) || result.setIndex < 0) {
          throw new InvalidWorkout(`setResults[${index}].setIndex`, 'Each set needs its position.')
        }
        return {
          planExerciseId: result.planExerciseId ?? null,
          setIndex: result.setIndex,
          reps: positive(result.reps, `setResults[${index}].reps`),
          durationSec: positive(result.durationSec, `setResults[${index}].durationSec`),
          weightKg: positive(result.weightKg, `setResults[${index}].weightKg`),
          completed: result.completed !== false,
          skipped: result.skipped === true,
        }
      })
    : []

  // A session needs a length or something in it; both blank is not a record.
  const durationSec = Math.max(0, Math.round(Number(input.durationSec ?? 0)))
  if (durationSec === 0 && exercises.length === 0) {
    throw new InvalidWorkout('durationSec', 'A workout needs a length or at least one exercise.')
  }

  return {
    date: input.date,
    kind: input.kind,
    name: String(input.name ?? '').trim() || 'Workout',
    status: input.status ?? 'completed',
    durationSec,
    caloriesKcal: Math.max(0, Number(input.caloriesKcal ?? 0)),
    difficulty: input.difficulty ?? null,
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
    loggedVia: input.loggedVia ?? 'manual',
    exercises,
    setResults,
  }
}
